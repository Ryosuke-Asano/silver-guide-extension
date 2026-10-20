import { PDFDocument, PDFName, PDFHexString, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] ?? join(root, 'tests', 'generated-fixtures'));
await mkdir(destination, { recursive: true });
const fontBytes = await readFile(join(root, 'public', 'assets', 'fonts', 'NotoSansCJKjp-Regular.otf'));
const create = async native => {
  const document = await PDFDocument.create(); document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: false });
  const page = document.addPage([595.28, 841.89]);
  page.drawText('申請書（動作検証用の架空様式）', { x: 76, y: 755, size: 21, font });
  page.drawText('これは Silver Guide の動作検証専用です。提出先はありません。', { x: 50, y: 716, size: 11, font });
  const fields = [ ['applicant_name', '氏名', 640, 45], ['furigana', 'ふりがな', 575, 45], ['address', '住所', 480, 75], ['telephone', '電話番号', 400, 45] ];
  for (const [name, label, y, height] of fields) {
    page.drawText(label, { x: 60, y: y + height / 2 - 5, size: 16, font });
    page.drawRectangle({ x: 155, y, width: 375, height, borderWidth: 1, borderColor: rgb(.3,.3,.3) });
    if (native) {
      const field = document.getForm().createTextField(name);
      field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(label));
      field.addToPage(page, { x: 157, y: y + 2, width: 371, height: height - 4, borderWidth: 0, fontSize: 16, font });
      if (name === 'applicant_name') field.enableRequired();
    }
  }
  page.drawText('署名は、ご自身で原書類に従って行ってください。', { x: 60, y: 300, size: 13, font });
  return document.save();
};
await writeFile(join(destination, 'native-form.pdf'), await create(true));
await writeFile(join(destination, 'text-form.pdf'), await create(false));
process.stdout.write(`Created synthetic verification fixtures in ${destination}\n`);
