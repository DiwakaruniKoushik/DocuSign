# Placeholder Detection App

## Setup

### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## Usage

1. Open http://localhost:3000
2. Upload a .docx file
3. View results in 3 panels:
   - Left: Detected fields
   - Middle: Chat interface
   - Right: Document info

## Features

- Detects [bracketed] placeholders
- Detects signature lines (Label:\t)
- Interactive chat
- Document download
