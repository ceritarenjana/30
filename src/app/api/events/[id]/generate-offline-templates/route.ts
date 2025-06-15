import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // Ambil semua file template e-ticket (upload_type = 'ticket_design')
    const [rows] = await db.execute(
      `SELECT id, filename, original_name, file_path, file_size, file_type, uploaded_at FROM file_uploads WHERE upload_type = 'ticket_design' ORDER BY uploaded_at DESC`
    )
    return NextResponse.json({ templates: rows })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
} 