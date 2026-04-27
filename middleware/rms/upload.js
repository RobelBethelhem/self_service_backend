import multer from 'multer';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') 
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname))
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 5 // Limit file size to 5MB
  }
});

async function mergePDFs(files) {
  const mergedPdf = await PDFDocument.create();
  
  for (const file of files) {
    if (file.mimetype === 'application/pdf') {
      const pdfBytes = await fs.readFile(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }
  }
  
  const pdfBytes = await mergedPdf.save();
  const mergedFilename = `merged_${uuidv4()}.pdf`;
  const mergedFilePath = path.join('uploads', mergedFilename);
  await fs.writeFile(mergedFilePath, pdfBytes);
  
  // Delete original files
  for (const file of files) {
    await fs.unlink(file.path);
  }
  
  return { filename: mergedFilename, path: mergedFilePath };
}

export { upload, mergePDFs };