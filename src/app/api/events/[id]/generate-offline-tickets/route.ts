import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import bwipjs from 'bwip-js'
import db from '@/lib/db'
import QRCode from 'qrcode'
import { PDFDocument, rgb } from 'pdf-lib'
import fs from 'fs/promises'

function isImageFile(file: File) {
  return file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.name?.endsWith('.png') || file.name?.endsWith('.jpg') || file.name?.endsWith('.jpeg'))
}

function getOptimalGrid(ticketWidth: number, ticketHeight: number, pageWidth: number, pageHeight: number) {
  // Cari grid optimal (misal 2x5, 3x3, dst) agar tiket fit ke kertas
  let best = { cols: 1, rows: 1, scale: 1, count: 1 }
  for (let cols = 1; cols <= 5; cols++) {
    for (let rows = 1; rows <= 10; rows++) {
      const scaleX = pageWidth / (cols * ticketWidth)
      const scaleY = pageHeight / (rows * ticketHeight)
      const scale = Math.min(scaleX, scaleY)
      const count = cols * rows
      if (scale < 0.2) continue // skip terlalu kecil
      if (count > best.count || (count === best.count && scale > best.scale)) {
        best = { cols, rows, scale, count }
      }
    }
  }
  return best
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const formData = await req.formData()
    const templateFile = formData.get('template')
    const barcodeX = Number(formData.get('barcode_x'))
    const barcodeY = Number(formData.get('barcode_y'))
    const barcodeWidth = Number(formData.get('barcode_width'))
    const barcodeHeight = Number(formData.get('barcode_height'))
    const eventId = params.id
    const [rows] = await db.execute('SELECT id, token FROM tickets WHERE event_id = ? ORDER BY id ASC', [eventId])
    const participants = (rows as any[]).map(row => ({ name: row.id, token: row.token }))

    console.log('📝 Processing offline ticket generation request...')
    console.log('Participants count:', participants.length)
    console.log('Barcode position:', { barcodeX, barcodeY, barcodeWidth, barcodeHeight })

    // Type guard for templateFile
    if (typeof templateFile !== 'object' || typeof (templateFile as any).arrayBuffer !== 'function' || typeof (templateFile as any).type !== 'string') {
      return NextResponse.json({ error: 'Invalid template file (not File/Blob)' }, { status: 400 })
    }

    const file = templateFile as File
    console.log('Template file:', file.name, file.type, file.size)

    if (!isImageFile(file)) {
      return NextResponse.json({ error: 'Template file must be PNG or JPG' }, { status: 400 })
    }

    if (participants.length === 0) {
      return NextResponse.json({ error: 'No participants to generate tickets for' }, { status: 400 })
    }

    if (participants.length > 1000) {
      return NextResponse.json({ error: 'Too many tickets, maximum 1000 per batch' }, { status: 400 })
    }

    let templateBuffer = Buffer.from(new Uint8Array(await file.arrayBuffer())) as Buffer

    // Convert JPG to PNG if needed
    if (file.type === 'image/jpeg' || file.name?.endsWith('.jpg') || file.name?.endsWith('.jpeg')) {
      try {
        templateBuffer = await sharp(templateBuffer).png().toBuffer()
        console.log('✅ Converted JPG to PNG')
      } catch (err) {
        return NextResponse.json({ error: 'Failed to convert JPG to PNG', detail: String(err) }, { status: 400 })
      }
    }

    // Get template dimensions
    const templateMeta = await sharp(templateBuffer).metadata()
    const templateWidth = templateMeta.width || 0
    const templateHeight = templateMeta.height || 0
    
    console.log('Template dimensions:', { templateWidth, templateHeight })
    console.log('Original barcode params:', { barcodeX, barcodeY, barcodeWidth, barcodeHeight })

    // Validate barcode position
    if (barcodeX < 0 || barcodeY < 0 || barcodeWidth <= 0 || barcodeHeight <= 0) {
      return NextResponse.json({ error: 'Invalid barcode position or size' }, { status: 400 })
    }

    if (barcodeX + barcodeWidth > templateWidth || barcodeY + barcodeHeight > templateHeight) {
      return NextResponse.json({
        error: `Barcode position exceeds template bounds. Template: ${templateWidth}x${templateHeight}px, Barcode: (${barcodeX},${barcodeY},${barcodeWidth},${barcodeHeight})`,
        templateWidth,
        templateHeight,
        barcodeX,
        barcodeY,
        barcodeWidth,
        barcodeHeight
      }, { status: 400 })
    }

    // Resize template to fit ticket size while maintaining aspect ratio
    let resizedTemplateBuffer: Buffer
    try {
      resizedTemplateBuffer = await sharp(templateBuffer)
        .resize(templateWidth, templateHeight, { 
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toBuffer()
      
      console.log('✅ Template resized to ticket dimensions')
    } catch (err) {
      return NextResponse.json({ error: 'Failed to resize template', detail: String(err) }, { status: 500 })
    }

    // Calculate scaling factors
    const scaleX = templateWidth / templateWidth
    const scaleY = templateHeight / templateHeight
    const scale = Math.min(scaleX, scaleY) // Use uniform scaling to maintain aspect ratio

    // Calculate scaled barcode position and size
    const scaledBarcodeX = Math.round(barcodeX * scale)
    const scaledBarcodeY = Math.round(barcodeY * scale)
    const scaledBarcodeWidth = Math.max(100, Math.round(barcodeWidth * scale)) // Minimum 100px width
    const scaledBarcodeHeight = Math.max(50, Math.round(barcodeHeight * scale)) // Minimum 50px height

    console.log('Scaled barcode params:', { 
      scale, 
      scaledBarcodeX, 
      scaledBarcodeY, 
      scaledBarcodeWidth, 
      scaledBarcodeHeight 
    })

    // Ensure barcode fits within ticket bounds
    const finalBarcodeX = Math.min(scaledBarcodeX, templateWidth - scaledBarcodeWidth)
    const finalBarcodeY = Math.min(scaledBarcodeY, templateHeight - scaledBarcodeHeight)
    const finalBarcodeWidth = Math.min(scaledBarcodeWidth, templateWidth - finalBarcodeX)
    const finalBarcodeHeight = Math.min(scaledBarcodeHeight, templateHeight - finalBarcodeY)

    console.log('Final barcode params:', { 
      finalBarcodeX, 
      finalBarcodeY, 
      finalBarcodeWidth, 
      finalBarcodeHeight 
    })

    // Generate ticket images
    const ticketImages: Buffer[] = []
    console.log('🎫 Generating ticket images...')

    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i]
      try {
        // Generate QR code dengan link register token (format benar)
        const registerLink = `http://10.10.11.28:3000/register?token=${participant.token}`
        const qrBufferRaw = await QRCode.toBuffer(registerLink, {
          errorCorrectionLevel: 'H',
          type: 'png',
          width: finalBarcodeWidth,
          margin: 0,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        })
        const borderSize = Math.round(Math.max(finalBarcodeWidth, finalBarcodeHeight) * 0.08) // 8% dari ukuran QR
        const qrWithBorder = await sharp({
          create: {
            width: finalBarcodeWidth + borderSize * 2,
            height: finalBarcodeHeight + borderSize * 2,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        })
          .composite([{ input: await sharp(qrBufferRaw).resize(finalBarcodeWidth, finalBarcodeHeight, { fit: 'fill' }).png().toBuffer(), left: borderSize, top: borderSize }])
          .png()
          .toBuffer()

        // Composite QR code onto template
        const ticketImg = await sharp(resizedTemplateBuffer)
          .composite([
            { 
              input: qrWithBorder, 
              left: finalBarcodeX - borderSize, 
              top: finalBarcodeY - borderSize 
            }
          ])
          .png()
          .toBuffer()

        ticketImages.push(ticketImg)

        if ((i + 1) % 10 === 0 || i === participants.length - 1) {
          console.log(`✅ Generated ${i + 1}/${participants.length} ticket images`)
        }
      } catch (err) {
        console.error('QR/template error for token:', participant.token, err)
        return NextResponse.json({ 
          error: 'Failed to generate QR/ticket', 
          detail: String(err), 
          token: participant.token 
        }, { status: 500 })
      }
    }

    console.log('📄 Generating PDF using canvas-based approach...')

    // Use canvas-based PDF generation instead of PDFKit to avoid font issues
    try {
      // Create a simple PDF-like structure using HTML canvas approach
      const { createCanvas } = await import('canvas')
      
      // Calculate pages needed
      const totalPages = Math.ceil(ticketImages.length / (templateWidth * templateHeight / 1000))
      const canvasPages: Buffer[] = []

      for (let page = 0; page < totalPages; page++) {
        const canvas = createCanvas(templateWidth, templateHeight)
        const ctx = canvas.getContext('2d')
        
        // Fill white background
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, templateWidth, templateHeight)

        // Place tickets on this page
        const startIdx = page * (templateWidth * templateHeight / 1000)
        const endIdx = Math.min(startIdx + (templateWidth * templateHeight / 1000), ticketImages.length)

        for (let i = startIdx; i < endIdx; i++) {
          const ticketIdx = i - startIdx
          const row = Math.floor(ticketIdx / (templateWidth / 1000))
          const col = ticketIdx % (templateWidth / 1000)
          
          const x = col * 1000
          const y = row * 1000

          // Load and draw ticket image
          const img = await import('canvas').then(({ loadImage }) => loadImage(ticketImages[i]))
          ctx.drawImage(img, x, y, 1000, 1000)
        }

        // Convert canvas to PNG buffer
        const pageBuffer = canvas.toBuffer('image/png')
        canvasPages.push(pageBuffer)
      }

      // Convert PNG pages to PDF using a simple approach
      const jsPDF = await import('jspdf').then(m => m.jsPDF)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [templateWidth, templateHeight]
      })

      for (let i = 0; i < canvasPages.length; i++) {
        if (i > 0) pdf.addPage()
        
        // Convert buffer to base64
        const base64 = canvasPages[i].toString('base64')
        pdf.addImage(`data:image/png;base64,${base64}`, 'PNG', 0, 0, templateWidth, templateHeight)
      }

      const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))
      
      console.log('✅ PDF generated successfully using canvas approach, size:', pdfBuffer.length, 'bytes')

      // Ukuran kertas A4 dalam point (1 pt = 1/72 inch)
      const A4_WIDTH = 595.28
      const A4_HEIGHT = 841.89
      const ticketMeta = await sharp(ticketImages[0]).metadata()
      const ticketW = ticketMeta.width || 1000
      const ticketH = ticketMeta.height || 500
      const grid = getOptimalGrid(ticketW, ticketH, A4_WIDTH, A4_HEIGHT)
      const pdfDoc = await PDFDocument.create()
      let page: any = null
      let ticketIdx = 0
      while (ticketIdx < ticketImages.length) {
        page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
        for (let row = 0; row < grid.rows; row++) {
          for (let col = 0; col < grid.cols; col++) {
            if (ticketIdx >= ticketImages.length) break
            const x = col * ticketW * grid.scale
            const y = A4_HEIGHT - ((row + 1) * ticketH * grid.scale)
            const imgBytes = ticketImages[ticketIdx]
            const img = await pdfDoc.embedPng(imgBytes)
            page.drawImage(img, {
              x,
              y,
              width: ticketW * grid.scale,
              height: ticketH * grid.scale
            })
            // Cutting guide (garis bantu potong)
            page.drawRectangle({
              x,
              y,
              width: ticketW * grid.scale,
              height: ticketH * grid.scale,
              borderColor: rgb(0.7,0.7,0.7),
              borderWidth: 0.7,
              color: undefined
            })
            ticketIdx++
          }
        }
      }
      const pdfBytes = await pdfDoc.save()
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="offline-tickets-${params.id}.pdf"`,
          'Content-Length': pdfBytes.length.toString(),
        },
      })

    } catch (canvasError) {
      console.error('Canvas PDF generation failed:', canvasError)
      
      // Fallback: Return images as ZIP file
      console.log('📦 Falling back to ZIP file generation...')
      
      try {
        const JSZip = await import('jszip').then(m => m.default)
        const zip = new JSZip()
        
        // Add each ticket image to ZIP
        for (let i = 0; i < ticketImages.length; i++) {
          const participant = participants[i]
          zip.file(`ticket-${participant.token}.png`, ticketImages[i])
        }
        
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
        
        console.log('✅ ZIP file generated successfully, size:', zipBuffer.length, 'bytes')
        
        return new NextResponse(zipBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="offline-tickets-${params.id}.zip"`,
            'Content-Length': zipBuffer.length.toString(),
          },
        })
        
      } catch (zipError) {
        console.error('ZIP generation also failed:', zipError)
        return NextResponse.json({ 
          error: 'Failed to generate both PDF and ZIP', 
          pdfError: String(canvasError),
          zipError: String(zipError)
        }, { status: 500 })
      }
    }

  } catch (err) {
    console.error('Generate offline tickets error:', err, (err instanceof Error ? err.stack : ''))
    return NextResponse.json({ 
      error: 'Failed to generate tickets', 
      detail: String(err),
      stack: err instanceof Error ? err.stack : undefined
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = new URL(request.url)
    const barcodeX = Number(url.searchParams.get('barcode_x'))
    const barcodeY = Number(url.searchParams.get('barcode_y'))
    const barcodeWidth = Number(url.searchParams.get('barcode_width'))
    const barcodeHeight = Number(url.searchParams.get('barcode_height'))
    const eventId = params.id
    const [rows] = await db.execute('SELECT id, token FROM tickets WHERE event_id = ? ORDER BY id ASC', [eventId])
    const participants = (rows as any[]).map(row => ({ name: row.id, token: row.token }))
    if (participants.length === 0) {
      return NextResponse.json({ error: 'No tickets to preview' }, { status: 400 })
    }
    // Ambil desain template dari file_uploads
    const [designRows] = await db.execute('SELECT file_path FROM file_uploads WHERE upload_type = ? AND related_id = ? ORDER BY id DESC LIMIT 1', ['ticket_design', eventId])
    if (!(designRows as any[]).length) {
      return NextResponse.json({ error: 'No ticket design uploaded' }, { status: 400 })
    }
    const designPath = (designRows as any[])[0].file_path
    const absPath = `${process.cwd()}/public${designPath}`
    let templateBuffer = await fs.readFile(absPath)
    // Gunakan parameter posisi barcode jika ada, jika tidak default pojok kanan bawah
    const ticketMeta = await sharp(templateBuffer).metadata()
    const ticketW = ticketMeta.width || 1000
    const ticketH = ticketMeta.height || 500
    let bx = barcodeX, by = barcodeY, bw = barcodeWidth, bh = barcodeHeight
    if (!barcodeX || !barcodeY || !barcodeWidth || !barcodeHeight) {
      // Default pojok kanan bawah
      bw = 200; bh = 200; bx = ticketW - 220; by = ticketH - 220;
    }
    // Generate QR code
    const QRCode = (await import('qrcode')).default
    const registerLink = `http://10.10.11.28:3000/register?token=${participants[0].token}`
    const qrBufferRaw = await QRCode.toBuffer(registerLink, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: bw,
      margin: 0,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
    // Tambahkan border putih di sekitar QR code
    const borderSize = Math.round(Math.max(bw, bh) * 0.08) // 8% dari ukuran QR
    const qrWithBorder = await sharp({
      create: {
        width: bw + borderSize * 2,
        height: bh + borderSize * 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .composite([{ input: await sharp(qrBufferRaw).resize(bw, bh, { fit: 'fill' }).png().toBuffer(), left: borderSize, top: borderSize }])
      .png()
      .toBuffer()
    // Tempel QR ke template sesuai posisi
    const ticketImg = await sharp(templateBuffer)
      .composite([{ input: qrWithBorder, left: bx - borderSize, top: by - borderSize }])
      .png()
      .toBuffer()
    // Layout ke A4 pakai pdf-lib (ambil 1 tiket saja)
    const A4_WIDTH = 595.28
    const A4_HEIGHT = 841.89
    const grid = getOptimalGrid(ticketW, ticketH, A4_WIDTH, A4_HEIGHT)
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
    const x = 0, y = A4_HEIGHT - (ticketH * grid.scale)
    const img = await pdfDoc.embedPng(ticketImg)
    page.drawImage(img, {
      x,
      y,
      width: ticketW * grid.scale,
      height: ticketH * grid.scale
    })
    // Cutting guide
    page.drawRectangle({
      x,
      y,
      width: ticketW * grid.scale,
      height: ticketH * grid.scale,
      borderColor: rgb(0.7,0.7,0.7),
      borderWidth: 0.7,
      color: undefined
    })
    const pdfBytes = await pdfDoc.save()
    // Convert halaman pertama PDF ke PNG pakai sharp
    const sharpPdf = sharp(pdfBytes, { density: 300, pages: 1 })
    const pngBuffer = await sharpPdf.png().toBuffer()
    return new NextResponse(pngBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="preview-ticket-${eventId}.png"`,
        'Content-Length': pngBuffer.length.toString(),
      },
    })
  } catch (err) {
    console.error('Preview ticket PDF error:', err)
    return NextResponse.json({ error: 'Failed to generate preview', detail: String(err) }, { status: 500 })
  }
}

// Handler multi-ticket preview untuk /api/events/[id]/generate-offline-tickets/multi-preview
export async function GET_MULTIPREVIEW(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const url = new URL(request.url)
    const barcodeX = Number(url.searchParams.get('barcode_x'))
    const barcodeY = Number(url.searchParams.get('barcode_y'))
    const barcodeWidth = Number(url.searchParams.get('barcode_width'))
    const barcodeHeight = Number(url.searchParams.get('barcode_height'))
    const eventId = params.id
    const [ticketRows] = await db.execute('SELECT id, token FROM tickets WHERE event_id = ? ORDER BY id ASC', [eventId])
    const participants = (ticketRows as any[]).map(row => ({ name: row.id, token: row.token }))
    if (participants.length === 0) {
      return NextResponse.json({ error: 'No tickets to preview' }, { status: 400 })
    }
    // Ambil desain template dari file_uploads
    const [designRows] = await db.execute('SELECT file_path FROM file_uploads WHERE upload_type = ? AND related_id = ? ORDER BY id DESC LIMIT 1', ['ticket_design', eventId])
    if (!(designRows as any[]).length) {
      return NextResponse.json({ error: 'No ticket design uploaded' }, { status: 400 })
    }
    const designPath = (designRows as any[])[0].file_path
    const absPath = `${process.cwd()}/public${designPath}`
    let templateBuffer = await fs.readFile(absPath)
    // Gunakan parameter posisi barcode jika ada, jika tidak default pojok kanan bawah
    const ticketMeta = await sharp(templateBuffer).metadata()
    const ticketW = ticketMeta.width || 1000
    const ticketH = ticketMeta.height || 500
    let bx = barcodeX, by = barcodeY, bw = barcodeWidth, bh = barcodeHeight
    if (!barcodeX || !barcodeY || !barcodeWidth || !barcodeHeight) {
      // Default pojok kanan bawah
      bw = 200; bh = 200; bx = ticketW - 220; by = ticketH - 220;
    }
    // Generate semua ticket images
    const ticketImages: Buffer[] = []
    const QRCode = (await import('qrcode')).default
    for (let i = 0; i < participants.length; i++) {
      const registerLink = `http://10.10.11.28:3000/register?token=${participants[i].token}`
      const qrBufferRaw = await QRCode.toBuffer(registerLink, {
        errorCorrectionLevel: 'H',
        type: 'png',
        width: bw,
        margin: 0,
        color: { dark: '#000000', light: '#FFFFFF' },
      })
      const borderSize = Math.round(Math.max(bw, bh) * 0.08)
      const qrWithBorder = await sharp({
        create: {
          width: bw + borderSize * 2,
          height: bh + borderSize * 2,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
      })
        .composite([{ input: await sharp(qrBufferRaw).resize(bw, bh, { fit: 'fill' }).png().toBuffer(), left: borderSize, top: borderSize }])
        .png()
        .toBuffer()
      const ticketImg = await sharp(templateBuffer)
        .composite([{ input: qrWithBorder, left: bx - borderSize, top: by - borderSize }])
        .png()
        .toBuffer()
      ticketImages.push(ticketImg)
    }
    // Layout ke A4 grid optimal
    const A4_WIDTH = 2480 // px @300dpi
    const A4_HEIGHT = 3508 // px @300dpi
    const grid = getOptimalGrid(ticketW, ticketH, A4_WIDTH, A4_HEIGHT)
    const cols = grid.cols, rows = grid.rows, scale = grid.scale
    // Buat canvas A4 kosong
    const { createCanvas, loadImage } = await import('canvas')
    const canvas = createCanvas(A4_WIDTH, A4_HEIGHT)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, A4_WIDTH, A4_HEIGHT)
    let ticketIdx = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (ticketIdx >= ticketImages.length) break
        const x = Math.round(col * ticketW * scale)
        const y = Math.round(row * ticketH * scale)
        const img = await loadImage(ticketImages[ticketIdx])
        ctx.drawImage(img, x, y, Math.round(ticketW * scale), Math.round(ticketH * scale))
        // Cutting guide
        ctx.strokeStyle = 'rgba(120,120,120,0.7)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, Math.round(ticketW * scale), Math.round(ticketH * scale))
        ticketIdx++
      }
    }
    // Return PNG buffer
    const pngBuffer = canvas.toBuffer('image/png')
    return new NextResponse(pngBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="multi-preview-tickets-${eventId}.png"`,
        'Content-Length': pngBuffer.length.toString(),
      },
    })
  } catch (err) {
    console.error('Multi-ticket preview error:', err)
    return NextResponse.json({ error: 'Failed to generate multi-ticket preview', detail: String(err) }, { status: 500 })
  }
}