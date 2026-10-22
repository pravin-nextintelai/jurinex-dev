# Devanagari Font Setup for PDF Generation

This directory contains fonts and VFS (Virtual File System) files needed for generating PDFs with Marathi (Devanagari script) text support.

## Directory Structure

```
src/fonts/
├── ttf/                          # TTF font files (source)
│   ├── NotoSansDevanagari-Regular.ttf
│   └── NotoSansDevanagari-Bold.ttf
├── vfs/                          # Generated VFS files (for pdfmake)
│   └── devanagari_vfs.js        # Auto-generated VFS file
└── README.md                     # This file
```

## Setup Instructions

### 1. Download Font Files

Download Noto Sans Devanagari fonts from Google Fonts:

1. Visit: https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari
2. Click "Download family"
3. Extract the ZIP file
4. Copy the following files to `src/fonts/ttf/`:
   - `NotoSansDevanagari-Regular.ttf`
   - `NotoSansDevanagari-Bold.ttf`

### 2. Generate VFS File

Run the generation script:

```bash
npm run generate:devanagari-vfs
```

Or use the direct command:

```bash
npm run build:fonts
```

This will:
- Check if font files exist
- Generate `devanagari_vfs.js` in `src/fonts/vfs/`
- Verify the generated file

### 3. Verify Setup

After generating the VFS file, restart your development server and test PDF generation with Marathi text.

## How It Works

1. **Font Detection**: The PDF component automatically detects Devanagari characters (Unicode range U+0900–U+097F) in the content.

2. **Font Loading**: When Devanagari text is detected:
   - The component attempts to load `devanagari_vfs.js`
   - Fonts are registered with pdfmake as `DevanagariFont`
   - If loading fails, it falls back to Roboto with a warning

3. **PDF Generation**: 
   - If Devanagari fonts are available → Uses `DevanagariFont`
   - If fonts are missing → Falls back to `Roboto` (with warning)
   - User is notified about font limitations

4. **Print Function**: The Print function uses system fonts (Noto Sans Devanagari, Mukta, Mangal) which provide better quality for Devanagari text.

## Troubleshooting

### Error: "File 'NotoSansDevanagari-Regular.ttf' not found in virtual file system"

**Solutions:**

1. **Regenerate VFS file:**
   ```bash
   npm run generate:devanagari-vfs
   ```

2. **Check font files exist:**
   - Verify `src/fonts/ttf/NotoSansDevanagari-Regular.ttf` exists
   - Verify `src/fonts/ttf/NotoSansDevanagari-Bold.ttf` exists

3. **Check VFS file structure:**
   - Open `src/fonts/vfs/devanagari_vfs.js`
   - Should contain: `export const pdfMake = { vfs: { ... } }`
   - Should include keys: `NotoSansDevanagari-Regular.ttf` and `NotoSansDevanagari-Bold.ttf`

4. **Clear build cache:**
   ```bash
   rm -rf node_modules/.vite
   npm run dev
   ```

5. **Use Print function instead:**
   - The Print function uses system fonts and provides better quality
   - Recommended for documents with significant Marathi content

### Font files are too large

The VFS file can be large (several MB). This is normal for Devanagari fonts. If you need to reduce size:

1. Use font subsetting tools to include only required characters
2. Consider using a CDN for fonts (requires different setup)
3. Use the Print function which doesn't require embedding fonts

### Module import errors

If you see import errors for `devanagari_vfs.js`:

1. Check the file path is correct: `src/fonts/vfs/devanagari_vfs.js`
2. Verify the export structure matches:
   ```javascript
   export const pdfMake = {
     vfs: {
       "NotoSansDevanagari-Regular.ttf": "...",
       "NotoSansDevanagari-Bold.ttf": "..."
     }
   };
   ```
3. Restart the development server

## Best Practices

1. **For English-only content**: No special setup needed, uses Roboto by default
2. **For Marathi content**: 
   - Generate VFS file as described above
   - Use Print function for best quality
   - PDF download works but may have limitations if fonts aren't loaded
3. **For mixed content**: Devanagari fonts will be used automatically when detected

## Unicode Ranges Supported

The component detects Devanagari text using these Unicode ranges:

- **U+0900–U+097F**: Main Devanagari block
- **U+1CD0–U+1CFF**: Vedic Extensions
- **U+A8E0–U+A8FF**: Devanagari Extended

## Additional Resources

- [Noto Sans Devanagari on Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari)
- [pdfmake Documentation](https://pdfmake.github.io/docs/)
- [Devanagari Unicode Chart](https://www.unicode.org/charts/PDF/U0900.pdf)

