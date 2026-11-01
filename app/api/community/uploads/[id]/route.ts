import { NextResponse } from 'next/server'
import { uploadClients, uploadColumns, uploadDatabaseError, uploadIdPattern, discardUpload, type CommunityUploadTicket } from '@/lib/community-upload.server'
import { inspectCommunityFile } from '@/lib/community-file-inspection.server'
import { CommunityFileError } from '@/lib/community-file-rules.server'
import { communityResponseHeaders as headers } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120
type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  try {
    const auth = await uploadClients(request)
    if (auth.response) return auth.response
    const { id } = await context.params
    if (!uploadIdPattern.test(id)) return NextResponse.json({ error: 'Invalid upload.' }, { status: 400, headers })
    const lookup = await auth.client.from('community_uploads').select(uploadColumns).eq('id', id).eq('owner_id', auth.user.id).maybeSingle()
    if (lookup.error) return NextResponse.json({ error: 'Could not check this upload.' }, { status: 503, headers })
    const original = lookup.data as CommunityUploadTicket | null
    if (!original || original.owner_id !== auth.user.id) return NextResponse.json({ error: 'Upload not found.' }, { status: 404, headers })
    if (original.state === 'complete') return NextResponse.json({ upload: { id, state: 'complete', mediaId: original.media_id } }, { headers })
    const start = await auth.client.rpc('community_begin_verify', { p_upload_id: id })
    if (start.error) return uploadDatabaseError(start.error.code)
    const ticket = start.data as CommunityUploadTicket
    if (ticket.state === 'complete') return NextResponse.json({ upload: { id, state: 'complete', mediaId: ticket.media_id } }, { headers })
    if (ticket.owner_id !== auth.user.id || !ticket.storage_key.startsWith(`${auth.user.id}/`) || ticket.storage_key.includes('..')) return NextResponse.json({ error: 'Upload not found.' }, { status: 404, headers })
    let result
    try {
      const object = await auth.admin.storage.from('community-media').download(ticket.storage_key)
      if (object.error || !object.data) throw new Error('download')
      if (object.data.size !== ticket.declared_bytes || object.data.type.split(';')[0].trim().toLowerCase() !== ticket.mime_type) throw new CommunityFileError('TYPE_MISMATCH')
      result = await inspectCommunityFile({ name: ticket.original_name, mime: ticket.mime_type, contents: Buffer.from(await object.data.arrayBuffer()) }, ticket.section)
    } catch (error) {
      const code = error instanceof CommunityFileError ? error.code : 'UPLOAD_FAILED'
      const cleanup = await discardUpload(auth.client, auth.admin, auth.user.id, id, code)
      return NextResponse.json({ code, cleanupPending: !cleanup.ok, error: 'This file was not accepted. Your local original has not been changed.' }, { status: error instanceof CommunityFileError ? 422 : 503, headers })
    }
    const committed = await auth.admin.rpc('community_commit_upload', { p_upload_id: id, p_owner: auth.user.id, p_bytes: result.bytes, p_kind: result.kind,
      p_sha256: result.sha256, p_duration: result.durationSeconds, p_width: result.width, p_height: result.height, p_frames: result.frames, p_work_language: result.workLanguage })
    if (committed.error) {
      // A lost response is not proof that the transaction failed. Reconcile an
      // existing receipt before cleanup; never blindly replay verification.
      const receipt = await auth.client.from('community_uploads').select('state,media_id').eq('id', id).eq('owner_id', auth.user.id).maybeSingle()
      if (receipt.data?.state === 'complete' && receipt.data.media_id) return NextResponse.json({ upload: { id, state: 'complete', mediaId: receipt.data.media_id } }, { headers })
      if (!['40001','22023','53000'].includes(committed.error.code)) return NextResponse.json({ code: 'VERIFY_STATUS_UNKNOWN', error: 'Verification status is not confirmed. Refresh your uploads before taking another action.' }, { status: 503, headers })
      const cleanup = await discardUpload(auth.client, auth.admin, auth.user.id, id, 'DRAFT_CHANGED')
      return NextResponse.json({ code: 'DRAFT_CHANGED', cleanupPending: !cleanup.ok, error: 'The file was not attached. Refresh the draft before uploading again.' }, { status: committed.error.code === '53000' ? 507 : 409, headers })
    }
    return NextResponse.json({ upload: { id, state: 'complete', mediaId: committed.data.id } }, { headers })
  } catch { return NextResponse.json({ error: 'Upload verification is unavailable. Check your upload status before trying again.' }, { status: 503, headers }) }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const auth = await uploadClients(request)
    if (auth.response) return auth.response
    const { id } = await context.params
    if (!uploadIdPattern.test(id)) return NextResponse.json({ error: 'Invalid upload.' }, { status: 400, headers })
    const result = await discardUpload(auth.client, auth.admin, auth.user.id, id, null)
    if (!result.ok) return uploadDatabaseError(result.code || 'CLEANUP_PENDING')
    return new NextResponse(null, { status: 204, headers })
  } catch { return NextResponse.json({ error: 'The file has not been marked as deleted. Cleanup may still be required.' }, { status: 503, headers }) }
}
