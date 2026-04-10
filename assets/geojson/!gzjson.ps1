<#
.SYNOPSIS
压缩脚本所在目录的所有 .geojson 文件为 .gz
#>

# 自动获取脚本所在文件夹
$folder = $PSScriptRoot
Write-Host "工作目录: $folder`n" -ForegroundColor Cyan

# 获取所有 .json 文件
$files = Get-ChildItem -Path $folder -Filter "*.json" -File

if (-not $files) {
  Write-Warning "未找到任何 .json 文件"
  pause
  exit
}

# 循环压缩
foreach ($file in $files) {
  $outFile = "$($file.FullName).gz"
    
  try {
    $inStream = [System.IO.File]::OpenRead($file.FullName)
    $outStream = [System.IO.File]::Create($outFile)
    $gzip = [System.IO.Compression.GZipStream]::new($outStream, [System.IO.Compression.CompressionMode]::Compress)
        
    $inStream.CopyTo($gzip)
        
    $inStream.Close()
    $gzip.Close()
    $outStream.Close()

    Write-Host "✅ 已压缩: $($file.Name)" -ForegroundColor Green
  }
  catch {
    Write-Error "❌ 失败: $($file.Name)`n$_"
  }
}

Write-Host "`n🎉 全部完成！" -ForegroundColor Cyan