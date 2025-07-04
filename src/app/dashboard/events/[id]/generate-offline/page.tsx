"use client"
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import JsBarcode from 'jsbarcode'
import { Rnd } from 'react-rnd'
import { useMediaQuery } from 'react-responsive'
import { ArrowLeft, Download, Upload, Settings, Eye, AlertCircle, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { toast } from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'

export default function GenerateOfflineTicketPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const eventId = params?.id
  
  const [template, setTemplate] = useState<File|null>(null)
  const [previewUrl, setPreviewUrl] = useState<string|null>(null)
  const [barcode, setBarcode] = useState({ x: 100, y: 100, width: 200, height: 80 })
  const [tickets, setTickets] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string|null>(null)
  const [error, setError] = useState<string|null>(null)
  const [success, setSuccess] = useState<string|null>(null)
  const [templateNaturalSize, setTemplateNaturalSize] = useState<{width:number, height:number}|null>(null)
  const [imgSize, setImgSize] = useState<{width:number, height:number}>({ width: 800, height: 300 })
  const [showLivePreview, setShowLivePreview] = useState(false)
  const [showMultiPreview, setShowMultiPreview] = useState(false)
  const [multiPreviewUrl, setMultiPreviewUrl] = useState<string|null>(null)
  const [multiPreviewLoading, setMultiPreviewLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  const isMobile = useMediaQuery({ maxWidth: 768 })
  const gridSize = 10
  const TICKET_W = 1200
  const TICKET_H = 680
  const SLOT_W = 1200
  const SLOT_H = 680

  // Fetch tickets for this event
  useEffect(() => {
    async function fetchTickets() {
      if (!eventId) return
      try {
        const res = await fetch(`/api/events/${eventId}/tickets`)
        if (!res.ok) throw new Error('Failed to fetch tickets')
        const data = await res.json()
        setTickets(data.tickets || [])
      } catch (err) {
        setError('Failed to fetch ticket data')
      }
    }
    fetchTickets()
  }, [eventId])

  // Tambahkan efek untuk fetch event saat mount
  useEffect(() => {
    async function fetchEvent() {
      if (!eventId) return
      try {
        const res = await fetch(`/api/events/${eventId}`)
        if (!res.ok) throw new Error('Failed to fetch event')
        const data = await res.json()
        if (data.ticket_design) {
          setPreviewUrl(data.ticket_design)
        }
        if (data.ticket_qr_position) {
          setBarcode(data.ticket_qr_position)
        }
      } catch (err) {
        // ignore error
      }
    }
    fetchEvent()
  }, [eventId])

  // Saat upload template, update ke backend
  const handleTemplateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be less than 10MB')
        toast.error('File size must be less than 10MB')
        return
      }
      setTemplate(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
      setError(null)
      setSuccess('Template uploaded successfully!')
      toast.success('Template uploaded successfully!')
      
      // Get natural dimensions
      const img = new window.Image()
      img.src = url
      img.onload = () => {
        setTemplateNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
        // Set reasonable preview size
        const maxWidth = isMobile ? 350 : 800
        const scale = Math.min(maxWidth / img.naturalWidth, 400 / img.naturalHeight)
        setImgSize({ 
          width: Math.round(img.naturalWidth * scale), 
          height: Math.round(img.naturalHeight * scale) 
        })
        
        // Set default barcode position (bottom right)
        setBarcode({
          x: Math.round(img.naturalWidth * scale * 0.7),
          y: Math.round(img.naturalHeight * scale * 0.7),
          width: Math.round(img.naturalWidth * scale * 0.25),
          height: Math.round(img.naturalHeight * scale * 0.2)
        })
      }
      // Upload ke backend
      const formData = new FormData()
      formData.append('ticketDesign', file)
      // Progress bar upload
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', `/api/events/${eventId}`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100)
          setUploadProgress(percent)
        }
      }
      xhr.onload = () => {
        setUploadProgress(0)
        if (xhr.status === 200) {
          toast.success('Template uploaded to server!')
        } else {
          toast.error('Failed to upload template!')
        }
      }
      xhr.onerror = () => {
        setUploadProgress(0)
        toast.error('Failed to upload template!')
      }
      setUploadProgress(1)
      xhr.send(formData)
    }
  }

  const handleBarcodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(0, Number(e.target.value))
    setBarcode({ ...barcode, [e.target.name]: value })
  }

  const snap = (v: number) => Math.round(v / gridSize) * gridSize

  const handleGenerate = async () => {
    if (!template || tickets.length === 0) {
      setError('Please upload a template and ensure there are tickets to generate')
      toast.error('Please upload a template and ensure there are tickets to generate')
      return
    }

    if (!templateNaturalSize) {
      setError('Template dimensions not available')
      return
    }

    setGenerating(true)
    setPdfUrl(null)
    setError(null)
    setSuccess(null)
    toast.loading('Sedang men-generate PDF...')

    try {
      // Convert preview coordinates to actual template coordinates
      const scaleX = templateNaturalSize.width / imgSize.width
      const scaleY = templateNaturalSize.height / imgSize.height
      
      const actualBarcodeX = Math.round(barcode.x * scaleX)
      const actualBarcodeY = Math.round(barcode.y * scaleY)
      const actualBarcodeWidth = Math.round(barcode.width * scaleX)
      const actualBarcodeHeight = Math.round(barcode.height * scaleY)

      console.log('Sending barcode params:', {
        preview: barcode,
        actual: { actualBarcodeX, actualBarcodeY, actualBarcodeWidth, actualBarcodeHeight },
        scale: { scaleX, scaleY },
        template: templateNaturalSize
      })

      const formData = new FormData()
      formData.append('template', template)
      formData.append('barcode_x', String(actualBarcodeX))
      formData.append('barcode_y', String(actualBarcodeY))
      formData.append('barcode_width', String(actualBarcodeWidth))
      formData.append('barcode_height', String(actualBarcodeHeight))
      formData.append('participants', JSON.stringify(tickets.map(t => ({ name: t.token, token: t.token }))))

      const res = await fetch(`/api/events/${eventId}/generate-offline-tickets`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errorData = await res.json()
        toast.dismiss()
        throw new Error(errorData.error || 'Failed to generate PDF')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      setSuccess(`PDF generated successfully! ${tickets.length} tickets created.`)
      toast.dismiss()
      toast.success(`PDF generated successfully! ${tickets.length} tickets created.`)
    } catch (err: any) {
      setError(err.message || 'Failed to generate PDF')
      toast.dismiss()
      toast.error(err.message || 'Failed to generate PDF')
    } finally {
      setGenerating(false)
    }
  }

  const resetBarcode = () => {
    if (imgSize.width && imgSize.height) {
      setBarcode({
        x: Math.round(imgSize.width * 0.7),
        y: Math.round(imgSize.height * 0.7),
        width: Math.round(imgSize.width * 0.25),
        height: Math.round(imgSize.height * 0.2)
      })
    }
  }

  const centerBarcode = () => {
    if (imgSize.width && imgSize.height) {
      setBarcode({
        x: Math.round((imgSize.width - barcode.width) / 2),
        y: Math.round((imgSize.height - barcode.height) / 2),
        width: barcode.width,
        height: barcode.height
      })
    }
  }

  // Saat ubah posisi QR, update ke backend
  useEffect(() => {
    if (!eventId) return
    // Simpan posisi QR ke backend setiap kali barcode berubah
    const saveQrPosition = async () => {
      await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketQrPosition: barcode })
      })
    }
    saveQrPosition()
  }, [barcode])

  // Perhitungan scaling frontend sama dengan backend
  const scaleX = templateNaturalSize ? TICKET_W / templateNaturalSize.width : 1
  const scaleY = templateNaturalSize ? TICKET_H / templateNaturalSize.height : 1
  const scale = Math.min(scaleX, scaleY)

  const scaledBarcodeX = Math.round(barcode.x * scale)
  const scaledBarcodeY = Math.round(barcode.y * scale)
  const scaledBarcodeWidth = Math.max(100, Math.round(barcode.width * scale))
  const scaledBarcodeHeight = Math.max(50, Math.round(barcode.height * scale))

  const barcodeOutOfBounds =
    scaledBarcodeX < 0 ||
    scaledBarcodeY < 0 ||
    scaledBarcodeX + scaledBarcodeWidth > TICKET_W ||
    scaledBarcodeY + scaledBarcodeHeight > TICKET_H

  // Ganti value QRCode dengan token peserta pertama jika ada, fallback ke CONTOH_TOKEN
  const qrToken = tickets.length > 0 ? tickets[0].token : 'CONTOH_TOKEN'

  // Fungsi untuk fetch preview PNG dari backend
  const fetchBackendPreview = async () => {
    if (!eventId) return
    setShowLivePreview(true)
    const params = new URLSearchParams()
    params.append('barcode_x', String(barcode.x))
    params.append('barcode_y', String(barcode.y))
    params.append('barcode_width', String(barcode.width))
    params.append('barcode_height', String(barcode.height))
    // Bisa tambahkan param lain jika perlu
    const url = `/api/events/${eventId}/generate-offline-tickets?${params.toString()}`
    setPreviewUrl(url)
  }

  // Fungsi untuk fetch multi-ticket preview PNG dari backend
  const fetchMultiPreview = async () => {
    if (!eventId) return
    setShowMultiPreview(true)
    setMultiPreviewLoading(true)
    const params = new URLSearchParams()
    params.append('barcode_x', String(barcode.x))
    params.append('barcode_y', String(barcode.y))
    params.append('barcode_width', String(barcode.width))
    params.append('barcode_height', String(barcode.height))
    const url = `/api/events/${eventId}/generate-offline-tickets/multi-preview?${params.toString()}`
    setMultiPreviewUrl(url)
  }

  // Pull-to-refresh di mobile
  useEffect(() => {
    if (!isMobile) return
    let startY = 0
    let isPulling = false
    let threshold = 60 // px
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY
        isPulling = true
      }
    }
    function onTouchMove(e: TouchEvent) {
      if (!isPulling) return
      const diff = e.touches[0].clientY - startY
      if (diff > threshold) {
        isPulling = false
        window.location.reload()
      }
    }
    function onTouchEnd() {
      isPulling = false
    }
    window.addEventListener('touchstart', onTouchStart)
    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [isMobile])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-white/20 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => router.back()}
                className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
                <span>Back</span>
              </button>
            </div>
            <div className="flex items-center space-x-3">
              <h1 className="text-xl font-bold text-gray-900">Generate Offline Tickets</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-800">Error</h3>
              <p className="text-red-700">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3">
            <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
            <div>
              <h3 className="font-medium text-green-800">Success</h3>
              <p className="text-green-700">{success}</p>
            </div>
          </div>
        )}

        {/* Template Upload */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Upload Ticket Template</span>
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-Ticket Design or Banner Events (Optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleTemplateChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <p className="text-xs text-gray-500 mt-1">
                Recommended size: 1280x720px or similar landscape ratio
              </p>
            </div>

            {templateNaturalSize && (
              <div className="text-sm text-green-600 bg-green-50 p-3 rounded-lg">
                Template loaded: <b>{templateNaturalSize.width}x{templateNaturalSize.height}px</b>
              </div>
            )}

            {/* Progress bar upload */}
            {uploadProgress > 0 && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
                <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
          </div>
        </div>

        {/* Barcode Position Editor */}
        {template && previewUrl && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center space-x-2">
              <Settings className="h-5 w-5" />
              <span>Position Barcode</span>
            </h2>

            <div className="space-y-6">
              {/* Controls */}
              <div className="flex flex-wrap gap-4 items-center">
                <button
                  onClick={resetBarcode}
                  className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  Reset Position
                </button>
                <div className="flex gap-2 items-center mt-4">
                  <button
                    onClick={centerBarcode}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Center Barcode
                  </button>
                  <button
                    onClick={fetchMultiPreview}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    style={{ marginLeft: 8 }}
                  >
                    Lihat Hasil Akhir (Live Preview)
                  </button>
                </div>
              </div>

              {/* Manual Controls */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">X Position</label>
                  <input
                    type="number"
                    name="x"
                    value={barcode.x}
                    onChange={handleBarcodeChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Y Position</label>
                  <input
                    type="number"
                    name="y"
                    value={barcode.y}
                    onChange={handleBarcodeChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Width</label>
                  <input
                    type="number"
                    name="width"
                    value={barcode.width}
                    onChange={handleBarcodeChange}
                    min="50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Height</label>
                  <input
                    type="number"
                    name="height"
                    value={barcode.height}
                    onChange={handleBarcodeChange}
                    min="30"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Visual Editor */}
              <div className="relative flex justify-center">
                <div className="relative border-2 border-gray-200 rounded-lg overflow-hidden" style={{ width: imgSize.width, height: imgSize.height }}>
                  <img
                    src={previewUrl}
                    alt="Template Preview"
                    className="w-full h-full object-cover"
                    style={{ width: imgSize.width, height: imgSize.height }}
                  />
                  
                  {/* Grid overlay */}
                  <div className="absolute inset-0 pointer-events-none">
                    {Array.from({ length: Math.ceil(imgSize.width / gridSize) }).map((_, i) => (
                      <div
                        key={`grid-v-${i}`}
                        className="absolute top-0 bottom-0 w-px bg-blue-200 opacity-30"
                        style={{ left: i * gridSize }}
                      />
                    ))}
                    {Array.from({ length: Math.ceil(imgSize.height / gridSize) }).map((_, i) => (
                      <div
                        key={`grid-h-${i}`}
                        className="absolute left-0 right-0 h-px bg-blue-200 opacity-30"
                        style={{ top: i * gridSize }}
                      />
                    ))}
                  </div>

                  {/* Draggable barcode */}
                  <Rnd
                    bounds="parent"
                    size={{ width: barcode.width, height: barcode.height }}
                    position={{ x: barcode.x, y: barcode.y }}
                    onDragStop={(e, d) => {
                      setBarcode({ ...barcode, x: snap(d.x), y: snap(d.y) })
                    }}
                    onResizeStop={(e, dir, ref, delta, pos) => {
                      setBarcode({
                        ...barcode,
                        width: snap(parseInt(ref.style.width)),
                        height: snap(parseInt(ref.style.height)),
                        x: snap(pos.x),
                        y: snap(pos.y)
                      })
                    }}
                    minWidth={50}
                    minHeight={30}
                    className="border-2 border-red-500 bg-red-100 bg-opacity-50 flex items-center justify-center"
                  >
                    <div className="text-xs font-bold text-red-700 bg-white px-2 py-1 rounded shadow">
                      QRCODE
                    </div>
                  </Rnd>
                </div>
              </div>

              <div className="text-sm text-gray-600 text-center">
                Drag and resize the red box to position the barcode on your template
              </div>
            </div>
          </div>
        )}

        {/* Ticket Info */}
        {tickets.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Ticket Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{tickets.length}</div>
                <div className="text-sm text-blue-700">Total Tickets</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {Math.ceil(tickets.length / 10)}
                </div>
                <div className="text-sm text-green-700">PDF Pages (10 tickets/page)</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">A4</div>
                <div className="text-sm text-purple-700">Print Format</div>
              </div>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 mb-8">
          <div className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Ready to Generate?</h3>
              <p className="text-gray-600">
                {template ? `Template uploaded. ${tickets.length} tickets will be generated.` : 'Please upload a template first.'}
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !template || tickets.length === 0}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center space-x-2"
            >
              {generating ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <Download className="h-5 w-5" />
                  <span>Generate PDF</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Download Section */}
        {pdfUrl && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Download Ready</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600">Your offline tickets PDF is ready for download.</p>
                <p className="text-sm text-gray-500">Print on A4 paper for best results.</p>
              </div>
              <a
                href={pdfUrl}
                download={`offline-tickets-event-${eventId}.pdf`}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors flex items-center space-x-2"
              >
                <Download className="h-5 w-5" />
                <span>Download PDF</span>
              </a>
            </div>
          </div>
        )}

        {/* Tombol Live Preview */}
        {template && (
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setShowLivePreview(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold shadow"
            >
              Lihat Hasil Akhir (Live Preview)
            </button>
          </div>
        )}

        {/* Modal Live Preview */}
        {showLivePreview && previewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 relative max-w-full" style={{ maxWidth: 900 }}>
              <button
                onClick={() => setShowLivePreview(false)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 bg-gray-100 rounded-full p-2"
                aria-label="Tutup preview"
              >
                ✕
              </button>
              <h2 className="text-lg font-bold mb-4 text-center">Live Preview Hasil Akhir Tiket (Real Backend)</h2>
              <div className="flex justify-center items-center">
                <img
                  src={previewUrl}
                  alt="Preview Ticket Backend"
                  className="rounded-lg border border-gray-200 shadow-lg max-w-full h-auto"
                  style={{ maxHeight: '70vh', objectFit: 'contain' }}
                />
              </div>
              <div className="mt-4 text-sm text-center text-gray-500">
                Preview ini dihasilkan langsung dari backend, identik dengan hasil export PDF.
              </div>
            </div>
          </div>
        )}

        {showMultiPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-xl shadow-2xl p-6 relative max-w-full" style={{ maxWidth: 1200 }}>
              <button
                onClick={() => setShowMultiPreview(false)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-800 bg-gray-100 rounded-full p-2"
                aria-label="Tutup preview"
              >
                ✕
              </button>
              <h2 className="text-lg font-bold mb-4 text-center">Live Preview Multi Ticket (A4)</h2>
              <div className="flex justify-center items-center min-h-[400px] min-w-[300px] relative">
                {multiPreviewLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-white bg-opacity-80 z-10">
                    <svg className="animate-spin h-12 w-12 text-blue-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    <span className="text-blue-700 font-semibold">Sedang memuat preview...</span>
                  </div>
                )}
                {multiPreviewUrl && (
                  <img
                    src={multiPreviewUrl}
                    alt="Multi Ticket Preview"
                    className="max-w-full max-h-[80vh] rounded border shadow"
                    style={{ background: '#f8fafc', opacity: multiPreviewLoading ? 0.5 : 1 }}
                    onLoad={() => setMultiPreviewLoading(false)}
                    onError={() => { setMultiPreviewLoading(false); toast.error('Gagal memuat preview multi-ticket!') }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast container (paling bawah komponen) */}
      <Toaster position="top-right" />
    </div>
  )
}