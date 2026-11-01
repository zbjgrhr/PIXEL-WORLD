import { NextResponse } from 'next/server'
import { communityServerClient } from './supabase/server'
import { communityAdminClient } from './supabase/admin.server'
import { communitySameOrigin, communityResponseHeaders as headers } from './community-http'

export interface CommunityUploadTicket {
  id: string; owner_id: string; post_id: string | null; section: 'workshop' | 'art'; language: 'zh-CN' | 'en';
  original_name: string; mime_type: string; kind: string; declared_bytes: number; storage_key: string;
  state: string; media_id: string | null; expires_at: string; failure_code: string | null;
}
export const uploadColumns = 'id,owner_id,post_id,section,language,original_name,mime_type,kind,declared_bytes,storage_key,state,media_id,expires_at,failure_code'
export const uploadIdPattern = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i

export async function uploadClients(request: Request) {
  if (!communitySameOrigin(request)) return { response: NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers }) }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return { response: NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers }) }
  const client = await communityServerClient(), admin = communityAdminClient()
  if (!client || !admin) return { response: NextResponse.json({ code: 'UPLOAD_NOT_CONFIGURED', error: 'File uploads are not configured.' }, { status: 503, headers }) }
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return { response: NextResponse.json({ error: 'Sign in to upload files.' }, { status: 401, headers }) }
  return { client, admin, user }
}

export function uploadDatabaseError(code: string) {
  return NextResponse.json({ code: code === '53000' ? 'COMMUNITY_STORAGE_LIMIT' : 'UPLOAD_NOT_SAVED', error: 'The upload was not saved. Check the current draft, available storage, and pending uploads.' }, { status: code === '53000' ? 507 : code === '40001' ? 409 : code === '42501' ? 404 : code === '22023' ? 400 : 503, headers })
}

/** Mark deletion first, so an in-flight verifier cannot register deleted bytes. */
export async function discardUpload(client: NonNullable<Awaited<ReturnType<typeof communityServerClient>>>, admin: NonNullable<ReturnType<typeof communityAdminClient>>, userId: string, uploadId: string, failureCode: string | null) {
  const start = await client.rpc('community_begin_upload_delete', { p_upload_id: uploadId })
  if (start.error) return { ok: false, code: start.error.code }
  const ticket = start.data as CommunityUploadTicket
  if (ticket.owner_id !== userId || !ticket.storage_key.startsWith(`${userId}/`) || ticket.storage_key.includes('..')) return { ok: false, code: '42501' }
  if (['failed','deleted'].includes(ticket.state)) return { ok: true }
  const removal = await admin.storage.from('community-media').remove([ticket.storage_key])
  if (removal.error && String((removal.error as { statusCode?: unknown }).statusCode) !== '404') return { ok: false, code: 'CLEANUP_PENDING' }
  const finish = await admin.rpc('community_finish_upload_delete', { p_upload_id: uploadId, p_owner: userId, p_failure_code: failureCode })
  return { ok: !finish.error, code: finish.error?.code }
}
