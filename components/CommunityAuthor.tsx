'use client'
import { useState } from 'react'
import type { PublicAuthor } from '@/lib/community-profile'
import { useUiLocale } from './ui/LanguageSwitcher'

export default function CommunityAuthor({ author }: { author: PublicAuthor }) {
  const en = useUiLocale() === 'en'
  const [failedUrl,setFailedUrl] = useState<string | null>(null)
  const name = author.displayName || (en ? 'Player' : '玩家')
  return <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}} data-no-ui-translation>
    {author.avatarUrl && failedUrl !== author.avatarUrl
      // Only the cropped application thumbnail is public.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={author.avatarUrl} width={32} height={32} alt="" loading="lazy" style={{borderRadius:'50%',objectFit:'cover'}} onError={() => setFailedUrl(author.avatarUrl)} />
      : <span aria-hidden style={{width:32,height:32,borderRadius:'50%',display:'grid',placeItems:'center',background:'#e1eee4'}}>{Array.from(name)[0]}</span>}
    <span>{name}</span>{author.isOfficial && <small>{en ? 'Official account' : '官方账号'}</small>}
    {!author.displayName && <small>{author.id.slice(0,8)}</small>}
  </div>
}
