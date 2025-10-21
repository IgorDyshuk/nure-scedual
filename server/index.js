import express from 'express';
import multer from 'multer';
import iconv from 'iconv-lite';
import chardet from 'chardet';
import cors from 'cors';

const PORT = process.env.PORT ?? 4000;
const TARGET_ENCODING = 'utf-8';

const app = express();
app.use(cors());
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB, adjust if larger files are expected
  },
});

const normalizeEncodingLabel = (name) => (name ?? '').toLowerCase();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/normalize-csv', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'CSV file is required under field name "file".' });
    return;
  }

  const { buffer, originalname } = req.file;

  const detection = chardet.analyse(buffer) ?? [];
  const [bestGuess] = detection;
  const detectedEncoding = normalizeEncodingLabel(bestGuess?.name) || TARGET_ENCODING;
  const confidence = bestGuess?.confidence ?? null;

  let csvText;
  let converted = false;
  let sourceEncoding = detectedEncoding;

  try {
    if (detectedEncoding === 'utf-8' || detectedEncoding === 'utf8') {
      csvText = buffer.toString('utf-8');
    } else {
      csvText = iconv.decode(buffer, detectedEncoding);
      converted = true;
    }
  } catch (error) {
    res.status(422).json({
      error: 'Failed to decode CSV with detected encoding.',
      details: error instanceof Error ? error.message : 'Unknown error',
      detectedEncoding,
    });
    return;
  }

  const normalizedBuffer = Buffer.from(csvText, TARGET_ENCODING);

  res.json({
    filename: originalname,
    detectedEncoding: sourceEncoding,
    confidence,
    converted,
    targetEncoding: TARGET_ENCODING,
    size: normalizedBuffer.byteLength,
    csv: normalizedBuffer.toString('utf-8'),
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`CSV normalization service listening on port ${PORT}`);
});
