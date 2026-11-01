import {describe,it,expect} from 'vitest'
import sharp from 'sharp'
import {createHash} from 'node:crypto'
import {profileInput,publicAuthor} from './community-profile'
import {avatarThumbnail} from './community-avatar.server'

describe('public author identity and thumbnails',()=>{
  it('does not infer official status from an IA name or accept identity fields',()=>{
    expect(profileInput({name:' 【IA】Introvert Arcade ',avatarMediaId:null,updatedAt:null,isOfficial:true,ownerId:'other'})).toEqual({p_name:'【IA】Introvert Arcade',p_avatar:null,p_expected:null,p_public_consent:false})
    expect(publicAuthor('account')).toEqual({id:'account',displayName:null,isOfficial:false,avatarUrl:null})
    expect(publicAuthor('account',{id:'account',display_name:'【IA】Introvert Arcade',is_official:false,avatar_media_id:'private',updated_at:'v'})).toEqual({id:'account',displayName:'【IA】Introvert Arcade',isOfficial:false,avatarUrl:'/api/community/profiles/account/avatar?v=v'})
  })
  it('rejects private credentials, malformed image references and missing or invalid versions',()=>{
    const valid={name:'Name',avatarMediaId:null,updatedAt:null}
    for(const patch of [{name:''},{name:'a\nb'},{name:`api_key=${'example'.repeat(8)}`},{avatarMediaId:'other/path.png'},{updatedAt:undefined},{updatedAt:'bad'}])expect(()=>profileInput({...valid,...patch})).toThrow()
  })
  it('serves only a 256px crop stripped of original metadata after hash verification',async()=>{
    const source=await sharp({create:{width:400,height:200,channels:3,background:'#567b62'}}).jpeg().withMetadata().toBuffer()
    const result=await avatarThumbnail(source,createHash('sha256').update(source).digest('hex'))
    const metadata=await sharp(result).metadata()
    expect(metadata).toMatchObject({width:256,height:256,format:'webp'})
    expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined()
    await expect(avatarThumbnail(source,'0'.repeat(64))).rejects.toThrow(/invalid/)
  })
  it('rejects non-image and oversized dimensions even with a matching hash',async()=>{
    for(const source of [Buffer.from('not an image'),await sharp({create:{width:4097,height:1,channels:3,background:'white'}}).png().toBuffer()])await expect(avatarThumbnail(source,createHash('sha256').update(source).digest('hex'))).rejects.toThrow()
  })
})
