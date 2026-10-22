# Visual Service

Python-based microservice for generating flowcharts from documents using Gemini 1.5 Flash.

## Features

- Generate flowcharts from single or multiple documents
- User-specific document access (JWT authentication)
- Integration with Document Service API
- Uses Gemini 1.5 Flash for AI-powered flowchart generation
- Returns Mermaid syntax for easy visualization

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export GEMINI_API_KEY=your_gemini_api_key
export DOCUMENT_SERVICE_URL=http://localhost:8080
export JWT_SECRET=your_jwt_secret
export PORT=8081
```

Or create a `.env` file:
```
GEMINI_API_KEY=your_gemini_api_key
DOCUMENT_SERVICE_URL=http://localhost:8080
JWT_SECRET=your_jwt_secret
PORT=8081
```

3. Run the service:
```bash
python app.py
```

## API Endpoints

### Generate Flowchart (Single Document)
```
POST /api/visual/generate-flowchart
Headers:
  Authorization: Bearer <token>
Body:
{
  "file_id": "uuid",
  "prompt": "optional custom prompt",
  "flowchart_type": "process"
}
```

### Generate Flowchart (Multiple Documents)
```
POST /api/visual/generate-flowchart-multi
Headers:
  Authorization: Bearer <token>
Body:
{
  "file_ids": ["uuid1", "uuid2"],
  "prompt": "optional custom prompt",
  "flowchart_type": "process"
}
```

### Health Check
```
GET /health
```

## Response Format

```json
{
  "success": true,
  "file_id": "uuid",
  "document_name": "document.pdf",
  "flowchart_type": "process",
  "flowchart_description": "Generated flowchart description...",
  "mermaid_syntax": "graph TD\nA[Start] --> B[Process]",
  "image_url": null,
  "generated_at": "2024-01-01T00:00:00",
  "user_id": "user_id"
}
```

