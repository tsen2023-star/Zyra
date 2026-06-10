"""
Fix UTF-8 encoding corruption caused by PowerShell reading as Windows-1252.
The file was read as cp1252 then re-written as UTF-8, mangling all non-ASCII chars.
To fix: read as UTF-8, re-encode each char as cp1252 byte, re-decode bytes as UTF-8.
"""

with open('App.tsx', 'rb') as f:
    raw = f.read()

# Strip BOM if present
if raw[:3] == b'\xef\xbb\xbf':
    raw = raw[3:]

# Decode as UTF-8 (this gives us the corrupted string)
corrupted = raw.decode('utf-8', errors='replace')

# Re-encode each character back to its cp1252 byte value
fixed_bytes = bytearray()
for ch in corrupted:
    code = ord(ch)
    if code < 128:
        fixed_bytes.append(code)          # ASCII unchanged
    elif code == 0xFFFD:
        pass                               # skip replacement chars (unrecoverable)
    else:
        try:
            b = ch.encode('cp1252')
            fixed_bytes.extend(b)
        except (UnicodeEncodeError, ValueError):
            try:
                b = ch.encode('latin-1')
                fixed_bytes.extend(b)
            except Exception:
                fixed_bytes.extend(ch.encode('utf-8'))

# Decode those bytes as UTF-8 to get the original content
fixed = fixed_bytes.decode('utf-8', errors='replace')

# Write back as UTF-8 without BOM, preserving original line endings
with open('App.tsx', 'w', encoding='utf-8', newline='') as f:
    f.write(fixed)

print(f"Done. {len(corrupted)} -> {len(fixed)} chars")
