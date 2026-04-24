import { loadReaderOverview } from '../../../../src/web/reader_overview.ts'

export async function handler(_request: Request): Promise<Response> {
  const overview = await loadReaderOverview()
  return Response.json({
    message: 'Reader 已刷新',
    overview,
  })
}

export const GET = handler
