import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { PDFDocument, rgb } from 'pdf-lib'
import fs from 'fs/promises'
import db from '@/lib/db'

function getOptimalGrid(certWidth: number, certHeight: number, pageWidth: number, pageHeight: number) {
  let best = { cols: 1, rows: 1, scale: 1, count: 1 }
  for (let cols = 1; cols <= 2; cols++) {
    for (let rows = 1; rows <= 4; rows++) {
      const scaleX = pageWidth / (cols * certWidth)
      const scaleY = pageHeight / (rows * certHeight)
      const scale = Math.min(scaleX, scaleY)
      const count = cols * rows
      if (scale < 0.3) continue
      if (count > best.count || (count === best.count && scale > best.scale)) {
        best = { cols, rows, scale, count }
      }
    }
  }
  return best
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const eventId = params.id
    // Ambil peserta & template sertifikat
    const [participantsRows] = await db.execute('SELECT p.name, c.path FROM participants p JOIN certificates c ON p.id = c.participant_id WHERE c.path IS NOT NULL AND c.path != "" AND p.ticket_id IN (SELECT id FROM tickets WHERE event_id = ?)', [eventId])
    const participants = participantsRows as any[]
    if (!participants.length) {
      return NextResponse.json({ error: 'No certificates to export' }, { status: 400 })
    }
    // Ambil template sertifikat (pakai file pertama dari certificates)
    const certPath = participants[0].path
    const absPath = `${process.cwd()}/public${certPath}`
    const certBuffer = await fs.readFile(absPath)
    const certMeta = await sharp(certBuffer).metadata()
    const certW = certMeta.width || 1200
    const certH = certMeta.height || 900
    // Layout ke A4
    const A4_WIDTH = 595.28
    const A4_HEIGHT = 841.89
    const grid = getOptimalGrid(certW, certH, A4_WIDTH, A4_HEIGHT)
    const pdfDoc = await PDFDocument.create()
    let page: any = null
    let certIdx = 0
    while (certIdx < participants.length) {
      page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
          if (certIdx >= participants.length) break
          const x = col * certW * grid.scale
          const y = A4_HEIGHT - ((row + 1) * certH * grid.scale)
          const imgBytes = await fs.readFile(`${process.cwd()}/public${participants[certIdx].path}`)
          const img = await pdfDoc.embedPng(imgBytes)
          page.drawImage(img, {
            x,
            y,
            width: certW * grid.scale,
            height: certH * grid.scale
          })
          // Cutting guide
          page.drawRectangle({
            x,
            y,
            width: certW * grid.scale,
            height: certH * grid.scale,
            borderColor: rgb(0.7,0.7,0.7),
            borderWidth: 0.7,
            color: undefined
          })
          certIdx++
        }
      }
    }
    const pdfBytes = await pdfDoc.save()
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="certificates-${eventId}.pdf"`,
        'Content-Length': pdfBytes.length.toString(),
      },
    })
  } catch (err) {
    console.error('Export certificates error:', err)
    return NextResponse.json({ error: 'Failed to export certificates', detail: String(err) }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const eventId = params.id
    const [participantsRows] = await db.execute('SELECT p.name, c.path FROM participants p JOIN certificates c ON p.id = c.participant_id WHERE c.path IS NOT NULL AND c.path != "" AND p.ticket_id IN (SELECT id FROM tickets WHERE event_id = ?) LIMIT 1', [eventId])
    const participants = participantsRows as any[]
    if (!participants.length) {
      return NextResponse.json({ error: 'No certificates to preview' }, { status: 400 })
    }
    const certPath = participants[0].path
    const absPath = `${process.cwd()}/public${certPath}`
    const certBuffer = await fs.readFile(absPath)
    const certMeta = await sharp(certBuffer).metadata()
    const certW = certMeta.width || 1200
    const certH = certMeta.height || 900
    // Layout ke A4
    const A4_WIDTH = 595.28
    const A4_HEIGHT = 841.89
    const grid = getOptimalGrid(certW, certH, A4_WIDTH, A4_HEIGHT)
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT])
    const img = await pdfDoc.embedPng(certBuffer)
    page.drawImage(img, {
      x: 0,
      y: A4_HEIGHT - certH * grid.scale,
      width: certW * grid.scale,
      height: certH * grid.scale
    })
    // Cutting guide
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - certH * grid.scale,
      width: certW * grid.scale,
      height: certH * grid.scale,
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
        'Content-Disposition': `inline; filename="preview-certificates-${eventId}.png"`,
        'Content-Length': pngBuffer.length.toString(),
      },
    })
  } catch (err) {
    console.error('Preview certificates error:', err)
    return NextResponse.json({ error: 'Failed to generate preview', detail: String(err) }, { status: 500 })
  }
} 