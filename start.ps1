Clear-Host

Write-Host ""
Write-Host "----------------------------------------"
Write-Host "         AbaChat Chat Room"
Write-Host "----------------------------------------"
Write-Host ""

Write-Host "[1/4] Checking Node.js..."
node --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Node.js not found!"
    Write-Host "Please install from: https://nodejs.org/"
    Read-Host "Press Enter to exit..."
    exit 1
}
$ver = node --version
Write-Host "OK: Node.js $ver"

Write-Host ""
Write-Host "[2/4] Checking npm..."
npm --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm not available!"
    Read-Host "Press Enter to exit..."
    exit 1
}
Write-Host "OK: npm ready"

Write-Host ""
Write-Host "[3/4] Installing dependencies..."
Write-Host "      (First run may take a few minutes)"
npm install --silent | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Failed to install dependencies!"
    Read-Host "Press Enter to exit..."
    exit 1
}
Write-Host "OK: Dependencies installed"

Write-Host ""
Write-Host "[4/4] Starting server..."
Write-Host ""
Write-Host "----------------------------------------"
Write-Host "    Server started!"
Write-Host ""
Write-Host "    Open browser at:"
Write-Host "         http://localhost:3000"
Write-Host ""
Write-Host "    Close this window to stop server"
Write-Host "----------------------------------------"
Write-Host ""

npm start