const JSZip = require('jszip');

async function test() {
  const zip = new JSZip();
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>李小明诉张伟房屋买卖合同纠纷案</w:t></w:r></w:p><w:p><w:r><w:t>一、案件基本信息</w:t></w:r></w:p></w:body></w:document>');
  
  const buf = await zip.generateAsync({type: 'nodebuffer'});
  
  const loadedZip = await JSZip.loadAsync(buf);
  const file = loadedZip.file('word/document.xml');
  const xml = await file.async('string');
  let t = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  console.log('Extracted text:\n' + t);
}
test();
