param(
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$LegacyEvidenceRoot
)
$ErrorActionPreference = 'Stop'
$evidencePath = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$outputPath = (Resolve-Path -LiteralPath $OutputDirectory).Path
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rounds = @()
$sources = @(Get-ChildItem -LiteralPath $evidencePath -Directory | Where-Object { $_.Name -match '^\d{2}-' } | Sort-Object Name)
if ($LegacyEvidenceRoot) { $sources += Get-Item -LiteralPath (Resolve-Path -LiteralPath $LegacyEvidenceRoot).Path }
foreach ($round in $sources) {
  $files = @()
  $archives = @()
  foreach ($file in (Get-ChildItem -LiteralPath $round.FullName -File -Recurse | Sort-Object FullName)) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    $relative = $file.FullName.Substring($round.FullName.Length + 1).Replace('\', '/')
    $files += [ordered]@{ path = $relative; bytes = $file.Length; modifiedUtc = $file.LastWriteTimeUtc.ToString('o'); sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    if ($file.Extension.ToLowerInvariant() -eq '.zip') {
      $archive = $null
      try {
        # Read central directory metadata only. Never extract or execute game files.
        $archive = [IO.Compression.ZipFile]::OpenRead($file.FullName)
        $entries = @($archive.Entries)
        $names = @($entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        $archives += [ordered]@{ path = $relative; directoryReadable = $true; entries = $entries.Count;
          uncompressedBytes = ($entries | Measure-Object -Property Length -Sum).Sum;
          containsHtml = @($names | Where-Object { $_ -match '(^|/)index\.html$' }).Count -gt 0;
          containsSpecCandidate = @($names | Where-Object { $_ -match '(?i)(^|/)(gamespec|game-spec|spec|project)\.json$' }).Count -gt 0;
          unsafeEntryPaths = @($names | Where-Object { $_ -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))' }).Count;
          playthroughVerified = $false; credentialReview = 'not-performed' }
      } catch {
        $archives += [ordered]@{ path = $relative; directoryReadable = $false; playthroughVerified = $false; credentialReview = 'not-performed' }
      } finally { if ($archive) { $archive.Dispose() } }
    }
  }
  $paths = @($files | ForEach-Object { $_.path })
  $images = @($paths | Where-Object { $_ -match '(?i)\.(png|jpe?g|webp)$' })
  # Keep extracted game sprites separate from actual evidence captures.
  $captures = @($images | Where-Object { $_ -notmatch '/' -or $_ -match '(?i)(^|/)(关键帧|screenshots|keyframes)/' })
  $rounds += [ordered]@{ name = $round.Name; sourceDirectory = $round.FullName; kind = $(if ($round.Name -match '^\d{2}-') { 'historical-round' } else { 'legacy-evidence-not-a-new-run' }); files = $files; archives = $archives;
    screenshots = $captures; otherImages = @($images | Where-Object { $captures -notcontains $_ });
    videos = @($paths | Where-Object { $_ -match '(?i)\.(mp4|gif|webm)$' });
    gameSpecs = @($paths | Where-Object { $_ -match '(?i)(gamespec|game-spec|game_spec).*\.json$' });
    configReports = @($paths | Where-Object { $_ -match '配置与耗时\.md$' });
    issueReports = @($paths | Where-Object { $_ -match '验收与问题\.md$' });
    runtimeRecords = @($paths | Where-Object { $_ -match '运行记录\.(txt|md|json)$' });
    currentVersionVerified = $false; videoDurationVerified = $false; offlinePlaythroughVerified = $false }
}
$inventory = [ordered]@{ version = 1; observedUtc = [DateTime]::UtcNow.ToString('o'); evidenceRoot = $evidencePath; scope = 'File existence, SHA-256 and ZIP directory metadata only; no model calls or gameplay. Logs are not read or copied.'; rounds = $rounds }
$inventory | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $outputPath 'evidence-inventory.json') -Encoding UTF8
$lines = @('# 三档验收：历史交付索引', '', '本索引只核实文件存在、哈希和 ZIP 目录可读性，不证明通关、视频时长、同轮来源或当前版本通过。所有历史文件保留原位，未读取/复制运行日志正文，也未公开发布。截图按根目录或关键帧目录识别；解压游戏中的素材图片单独记录，不计入截图。', '', '| 轮次 | 截图 | 其他图片 | 视频/GIF | ZIP | GameSpec | 配置/问题/运行记录 |', '| --- | ---: | ---: | ---: | ---: | ---: | --- |')
foreach ($item in $rounds) {
  $lines += "| $($item.name) | $($item.screenshots.Count) | $($item.otherImages.Count) | $($item.videos.Count) | $($item.archives.Count) | $($item.gameSpecs.Count) | $($item.configReports.Count)/$($item.issueReports.Count)/$($item.runtimeRecords.Count) |"
}
$lines += @('', '## 直接查找文件', '')
foreach ($item in $rounds) {
  $lines += @("### $($item.name)", '')
  $candidates = @($item.videos) + @($item.archives | ForEach-Object { $_.path }) + @($item.gameSpecs) + @($item.configReports) + @($item.issueReports)
  if (!$candidates.Count) { $lines += '- 尚无视频/GIF、ZIP、独立 GameSpec 或完整配置/问题报告。' }
  foreach ($candidate in $candidates) {
    $absolute = (Join-Path $item.sourceDirectory $candidate).Replace('\', '/')
    $label = $candidate.Replace('[', '').Replace(']', '')
    $lines += "- [$label](<$absolute>)"
  }
  foreach ($zip in $item.archives) { $lines += "- ZIP 目录可读：$($zip.directoryReadable)；HTML 入口：$($zip.containsHtml)；规格文件候选：$($zip.containsSpecCandidate)。未执行游戏或完成离线通关。" }
  $lines += ''
}
$lines += @('## 继承与补测口径', '', '- 旧截图、GIF、ZIP 和报告均保留为历史证据；目录名中的模型仅是线索，准确配置以当轮报告和请求记录为准。', '- 失败或部分完成可以归档，不能因缺少游戏 ZIP 假造导出成功。', '- 所有历史轮次均未由此索引认证为当前版本的中英文三档成品；新版本六次真实链路仍需独立验收。', '- ZIP 目录可读不等于内容安全或可玩；公开前仍需脱敏、权属检查、同轮核对及实际试玩。', '- 完整文件列表、大小、时间及 SHA-256 见同目录 evidence-inventory.json。本机路径只供定位，不能直接作为社区附件。')
$lines | Set-Content -LiteralPath (Join-Path $outputPath '00-历史交付索引.md') -Encoding UTF8
$rounds | ForEach-Object { [pscustomobject]@{ Round = $_.name; Screenshots = $_.screenshots.Count; Videos = $_.videos.Count; ZIPs = $_.archives.Count; GameSpecs = $_.gameSpecs.Count; ZIPDirectoryReadable = @($_.archives | Where-Object { $_.directoryReadable }).Count } } | ConvertTo-Json -Compress
