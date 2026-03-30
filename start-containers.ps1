$env:PATH = "C:\Program Files\Docker\Docker\resources\bin;C:\Program Files\Docker\cli-plugins;" + $env:PATH
Set-Location "E:\Projecys\nakama"
docker-compose.exe up -d
