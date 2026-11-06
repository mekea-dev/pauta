# gerar-icones.ps1 - gera os icones PNG do Pauta (192, 512, "maskable" 512 e apple-touch 180).
# Usa so o System.Drawing do Windows (nada para instalar). Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\gerar-icones.ps1
# O desenho e o mesmo de icons\icon.svg: quadrado violeta com um "visto" branco.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-PautaIcon([int]$size, [string]$file, [bool]$maskable) {
    $bmp = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = [System.Drawing.RectangleF]::new(0, 0, $size, $size)
    $c1 = [System.Drawing.ColorTranslator]::FromHtml('#8b6cf0')
    $c2 = [System.Drawing.ColorTranslator]::FromHtml('#5a32d0')
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $c1, $c2, 45.0)

    if ($maskable) {
        # sem cantos: o sistema recorta (iOS/Android); o "visto" fica na zona segura central
        $g.FillRectangle($brush, $rect)
    } else {
        $d = [single]($size * 116 / 512 * 2)
        $s = [single]$size
        $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($s - $d, 0, $d, $d, 270, 90)
        $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
        $path.AddArc(0, $s - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $g.FillPath($brush, $path)
    }

    $k = if ($maskable) { 0.72 } else { 1.0 }
    $half = $size / 2.0
    $unit = $size / 512.0 * $k
    $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [single](46 * $unit))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([single]($half + (144 - 256) * $unit), [single]($half + (270 - 256) * $unit)),
        [System.Drawing.PointF]::new([single]($half + (226 - 256) * $unit), [single]($half + (352 - 256) * $unit)),
        [System.Drawing.PointF]::new([single]($half + (372 - 256) * $unit), [single]($half + (176 - 256) * $unit))
    )
    $g.DrawLines($pen, $pts)

    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose(); $brush.Dispose(); $g.Dispose(); $bmp.Dispose()
    Write-Host ('ok: ' + $file + ' (' + $size + 'x' + $size + ')')
}

New-PautaIcon 192 'icon-192.png' $false
New-PautaIcon 512 'icon-512.png' $false
New-PautaIcon 512 'icon-maskable-512.png' $true
New-PautaIcon 180 'apple-touch-icon.png' $true
