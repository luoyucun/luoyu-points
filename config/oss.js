require('dotenv').config();

async function uploadToOSS(fileBuffer, originalName, folder = 'score-records') {
  const id  = process.env.OSS_ACCESS_KEY_ID;
  const sec = process.env.OSS_ACCESS_KEY_SECRET;
  if (!id || id === 'your_oss_access_key_id') {
    throw new Error('OSS未配置，图片跳过上传');
  }
  const OSS = require('ali-oss');
  const client = new OSS({
    region:          process.env.OSS_REGION,
    accessKeyId:     id,
    accessKeySecret: sec,
    bucket:          process.env.OSS_BUCKET,
  });
  const ext = originalName.split('.').pop();
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  await client.put(key, fileBuffer);
  return `https://${process.env.OSS_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`;
}

module.exports = { uploadToOSS };
