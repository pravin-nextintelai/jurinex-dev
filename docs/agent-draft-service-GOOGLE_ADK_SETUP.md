# Google ADK Setup Guide

## Overview

The JuriNex Agent Draft Service now uses **Google's Agent Development Kit (ADK)** with **Gemini models** for intelligent legal document processing.

## What Changed

### ✅ Agents Using Google ADK (Gemini LLM)

Three agents now use Google's Gemini model for AI-powered processing:

1. **Drafter Agent** 🤖
   - Generates legal draft documents from retrieved context
   - Uses Gemini 2.5 Pro for high-quality legal writing
   - System prompt: `instructions/drafter.txt`

2. **Critic Agent** 🤖
   - Validates drafts for legal correctness and completeness
   - Identifies contradictions and missing clauses
   - System prompt: `instructions/critic.txt`

3. **Assembler Agent** 🤖
   - Formats and assembles final documents
   - Converts to HTML/TipTap JSON structure
   - System prompt: `instructions/assembler.txt`

### ℹ️ Agents Using Local Python (No LLM)

Two agents use deterministic Python implementations (no LLM needed):

1. **Ingestion Agent**
   - Uploads to GCS, runs Document AI OCR
   - Chunks, embeds, and stores in database
   - Pure data processing pipeline

2. **Librarian Agent**
   - Performs vector similarity search
   - Returns relevant document chunks
   - Pure retrieval pipeline

## Setup Instructions

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `google-genai` - Google ADK SDK for Gemini
- `google-cloud-storage` - For GCS uploads
- `google-cloud-documentai` - For OCR/text extraction
- Other standard dependencies

### 2. Get Google API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key for Gemini
3. Copy the API key

### 3. Configure Environment

Add to your `.env` file:

```env
# Google ADK/Gemini API Key (required for Drafter/Critic/Assembler)
GOOGLE_API_KEY=your_gemini_api_key_here

# Or use GEMINI_API_KEY (both work)
GEMINI_API_KEY=your_gemini_api_key_here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/jurinex

# Optional: GCS and Document AI (for ingestion)
GCS_BUCKET_NAME=your_bucket_name
GOOGLE_CLOUD_PROJECT=your_project_id
DOCUMENT_AI_PROCESSOR_ID=your_processor_id
DOCUMENT_AI_LOCATION=us
```

### 4. Test the Setup

#### Test with Mock Mode (No API calls)

```bash
JURYNEX_MODE=mock python orchestrator_cli.py
```

Enter test input when prompted. This uses mock responses for all agents.

#### Test with Google ADK

```bash
python orchestrator_cli.py
```

This will:
- Use local pipeline for Ingestion and Librarian
- Use Google ADK/Gemini for Drafter, Critic, and Assembler

#### Test via API

```bash
uvicorn api.app:app --reload --host 0.0.0.0 --port 8000
```

Visit `http://localhost:8000/docs` for Swagger UI.

## Usage Examples

### Initialize ADK Client

```python
from services.adk_client import ADKClient, ADKAgentConfig
import os

# Initialize with API key
client = ADKClient(
    api_key=os.getenv("GOOGLE_API_KEY"),
    use_local_ingestion=True,    # Python pipeline (recommended)
    use_local_librarian=True,    # Python retrieval (recommended)
    use_local_drafter=False,     # Use Gemini ✅
    use_local_critic=False,      # Use Gemini ✅
    use_local_assembler=False,   # Use Gemini ✅
)

# Register agents with their system prompts
for agent_name in ["drafter", "critic", "assembler"]:
    system_prompt = load_prompt(f"instructions/{agent_name}.txt")
    client.create_agent(
        ADKAgentConfig(
            name=agent_name,
            system_prompt=system_prompt,
            model="gemini-2.5-pro"
        )
    )
```

### Run Agents

```python
# 1. Ingest document (local Python pipeline)
ingestion_result = client.run_agent("ingestion", {
    "user_id": "123",
    "file_content": base64_file,
    "originalname": "contract.pdf"
})

# 2. Retrieve relevant chunks (local Python retrieval)
librarian_result = client.run_agent("librarian", {
    "user_id": "123",
    "query": "relevant clauses for employment contract",
    "top_k": 10
})

# 3. Draft document (Google ADK/Gemini)
draft_result = client.run_agent("drafter", {
    "chunks": librarian_result["chunks"],
    "embeddings": librarian_result["embeddings"]
})

# 4. Validate draft (Google ADK/Gemini)
critic_result = client.run_agent("critic", {
    "draft": draft_result["draft"]
})

# 5. Assemble final document (Google ADK/Gemini)
final_result = client.run_agent("assembler", {
    "draft": draft_result["draft"],
    "template_html": template_html
})

print(final_result["final_document"])
```

## Model Configuration

### Available Models

- **`gemini-2.5-pro`** - Most capable, best for complex legal drafting (default)
- **`gemini-1.5-pro`** - Balanced performance and cost
- **`gemini-1.5-flash`** - Faster and cheaper, good for validation

### Customize Per Agent

```python
# Use pro for drafting, flash for validation (cost optimization)
client.create_agent(ADKAgentConfig(
    name="drafter",
    system_prompt=drafter_prompt,
    model="gemini-2.5-pro"  # Best quality
))

client.create_agent(ADKAgentConfig(
    name="critic",
    system_prompt=critic_prompt,
    model="gemini-1.5-flash"  # Faster/cheaper
))

client.create_agent(ADKAgentConfig(
    name="assembler",
    system_prompt=assembler_prompt,
    model="gemini-1.5-flash"  # Faster/cheaper
))
```

## Cost Optimization

### Tips to Minimize API Costs

1. **Use Local Agents** - Ingestion and Librarian don't need LLM (already default)

2. **Choose Appropriate Models**
   - Use `gemini-2.5-pro` for complex drafting
   - Use `gemini-1.5-flash` for validation and formatting

3. **Implement Caching**
   ```python
   # Cache system prompts (reduces token usage)
   # Google ADK automatically caches system prompts
   ```

4. **Batch Processing** - Process multiple drafts in sequence rather than parallel

5. **Set Token Limits**
   ```python
   # In ADKAgentConfig (future enhancement)
   config = ADKAgentConfig(
       name="drafter",
       system_prompt=prompt,
       model="gemini-2.5-pro",
       max_output_tokens=2048  # Limit output
   )
   ```

6. **Monitor Usage** - Check Google AI Studio for API usage and costs

### Estimated Costs (as of 2026)

- **Gemini 2.5 Pro**: ~$7/million input tokens, ~$21/million output tokens
- **Gemini 1.5 Flash**: ~$0.35/million input tokens, ~$1.05/million output tokens

For a typical legal draft:
- Input: ~10K tokens (context + instructions)
- Output: ~2K tokens (draft)
- **Cost per draft**: ~$0.05 - $0.15 (pro) or ~$0.01 - $0.03 (flash)

## Troubleshooting

### Error: "Google ADK SDK is not installed"

```bash
pip install google-genai
```

### Error: "Missing GOOGLE_API_KEY"

Add to `.env`:
```env
GOOGLE_API_KEY=your_api_key_here
```

Or export:
```bash
export GOOGLE_API_KEY=your_api_key_here
```

### Error: "Failed to create agent"

1. Check your API key is valid
2. Verify internet connection
3. Check Google AI Studio for service status
4. Ensure you have API quota available

### Agent returns empty response

1. Check system prompt in `instructions/{agent_name}.txt`
2. Verify payload format matches expected input
3. Check logs for detailed error messages

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                  Orchestrator                       │
│              (Coordinates workflow)                 │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│  Ingestion   │        │  Librarian   │
│   (Python)   │        │   (Python)   │
│              │        │              │
│ GCS Upload   │        │ Vector       │
│ Document AI  │        │ Search       │
│ Chunking     │        │ Retrieval    │
│ Embedding    │        │              │
└──────────────┘        └──────┬───────┘
                               │
                               ▼
                    ┌──────────────────┐
                    │  Drafter (ADK)   │
                    │  🤖 Gemini       │
                    │                  │
                    │ Draft Legal Doc  │
                    └─────────┬────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Critic (ADK)    │
                    │  🤖 Gemini       │
                    │                  │
                    │ Validate Draft   │
                    └─────────┬────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Assembler (ADK)  │
                    │  🤖 Gemini       │
                    │                  │
                    │ Format Document  │
                    └─────────┬────────┘
                              │
                              ▼
                       Final Document
```

## Documentation

- **[AGENTS_ARCHITECTURE.md](AGENTS_ARCHITECTURE.md)** - Detailed agent architecture
- **[docs/AGENT_FLOW.md](docs/AGENT_FLOW.md)** - Complete flow documentation
- **[README.md](README.md)** - Main project README
- **[instructions/](instructions/)** - System prompts for each agent

## Support

For issues or questions:
1. Check the documentation above
2. Review error logs in the terminal
3. Verify your environment configuration
4. Check Google AI Studio for API status

## Summary

🎉 **Three agents now use Google ADK with Gemini:**
- Drafter 🤖 - AI-powered legal drafting
- Critic 🤖 - AI-powered validation
- Assembler 🤖 - AI-powered formatting

✅ **Setup complete when:**
- `google-genai` is installed
- `GOOGLE_API_KEY` is configured
- Agents are registered with their prompts
- API is running without errors

🚀 **Ready to draft legal documents with AI!**
