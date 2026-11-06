# servir.ps1 - servidor local simples para testar o Pauta (sem instalar nada).
# Uso:  powershell -NoProfile -ExecutionPolicy Bypass -File .\servir.ps1   (depois abra http://localhost:8789/)
# Testes no navegador: http://localhost:8789/tests/
param([int]$Port = 8789, [string]$Dir = '')
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Dir)) { $Dir = $PSScriptRoot }
$root = [IO.Path]::GetFullPath($Dir)
$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'; '.woff2' = 'font/woff2'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:' + $Port + '/')
$listener.Start()
Write-Host ('Servindo ' + $root + ' em http://localhost:' + $Port + '/  (Ctrl+C para parar)')
try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $res = $ctx.Response
        try {
            $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/').Replace('/', '\')
            $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
            $status = 200
            if (-not ($file.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or $file.TrimEnd('\') -eq $root.TrimEnd('\'))) { $status = 403 }
            elseif (Test-Path -LiteralPath $file -PathType Container) { $file = Join-Path $file 'index.html' }
            if ($status -eq 200 -and -not (Test-Path -LiteralPath $file -PathType Leaf)) { $status = 404 }
            if ($status -ne 200) {
                $bytes = [Text.Encoding]::UTF8.GetBytes('Nao encontrado')
                $res.StatusCode = $status; $res.ContentType = 'text/plain; charset=utf-8'
            } else {
                $bytes = [IO.File]::ReadAllBytes($file)
                $ext = [IO.Path]::GetExtension($file).ToLower()
                $res.StatusCode = 200
                if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
            }
            $res.Headers.Add('Cache-Control', 'no-store')
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch { }
        finally { $res.Close() }
    }
} finally { $listener.Stop() }
