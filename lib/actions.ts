'use server'

import { prisma } from '@/lib/prisma'
import type { ExportResult } from '@/lib/types'

export async function logExport(platform: string, product: string): Promise<ExportResult> {
  try {
    await prisma.exportLog.create({
      data: { platform, product },
    })
    return { success: true }
  } catch {
    return { success: false, error: 'Failed to log export event' }
  }
}

export async function getExportCount(): Promise<number> {
  try {
    return await prisma.exportLog.count()
  } catch {
    return 0
  }
}
