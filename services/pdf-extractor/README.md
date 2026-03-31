# Receipt PDF Extractor

FastAPI service for:
- `/extract` to OCR-friendly text extraction from PDF bytes
- `/trim` to keep only selected PDF pages and return a smaller PDF

## Local run

```powershell
cd C:\projects\cash36\services\pdf-extractor
C:\projects\cash36\.venv\Scripts\python.exe -m pip install -r requirements.txt
C:\projects\cash36\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Health check:

```text
http://localhost:8000/health
```

## Railway deploy

1. Create a new Railway project from the GitHub repo.
2. Set the service root directory to `services/pdf-extractor`.
3. Railway should auto-detect the `Procfile` / `railway.toml`.
4. Deploy and copy the public URL, for example:

```text
https://receipt-pdf-extractor-production.up.railway.app
```

## Connect to the hosted app

Set this environment variable in the Vercel app:

```text
PDF_SERVICE_URL=https://your-public-railway-url
```

After setting it, redeploy the Vercel app.

## Trim request example

```json
{
  "file": "<base64-pdf>",
  "pages": "1-2,4"
}
```
