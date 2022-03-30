const bodyParser = require("body-parser");
const express = require("express");
const path = require('path');
const sharp = require('sharp');
const { S3 } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

const ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';
const TN_SUFFIX = '_tn.jpg';

// Never, ever, ever put credentials in code!
require('dotenv').config()

const client = new S3({
  endpoint: ENDPOINT,
  region: 'us-west-004'
});

const router = express.Router();
const app = express();

app.use(bodyParser.json());

const splitPath = (fullpath) => {
  // Skip the initial '/'
  const index = fullpath.indexOf('/', 1);
  const bucket = fullpath.substring(1, index);
  const path = fullpath.substring(index + 1);

  return [bucket, path];
}

router.post('/',async (request,response) => {
  // Don't make thumbnails of thumbnails!
  if (request.body.url.endsWith(TN_SUFFIX)) {
    response.json({
      url: request.body.url
    });    
  }

  // Extract the bucket and key from the incoming URL
  const inputUrl = new URL(request.body.url);
  const [bucket, key] = splitPath(inputUrl.pathname);

  try {
    console.log(`Fetching image from ${inputUrl}`);
    const obj = await client.getObject({
      Bucket: bucket,
      Key: key
    });

    // Create a Sharp transformer into which we can stream image data
    const transformer = sharp()
      .rotate()
      .resize(240)
      .jpeg();

    // Pipe the image data into the transformer
    obj.Body.pipe(transformer);

    // We can read the transformer output into a buffer, since we know 
    // thumbnails are small enough to fit in memory
    const thumbnail = await transformer.toBuffer();

    const outputKey = path.parse(key).name + TN_SUFFIX;
    const outputUrl = path.join(ENDPOINT, bucket, outputKey);

    console.log(`Writing thumbnail to ${outputUrl}`);
    await client.putObject({
      Bucket: bucket,
      Key: key,
      Body: thumbnail
    });

    response.json({
      url: outputUrl
    });
  } catch (err) {
    console.log(err);
    response.sendStatus(500).end();    
  }
});

app.use("/", router);

const port = process.env.PORT || 3000;

app.listen(port,() => {
  console.log(`Listening on port ${port}`);
})
