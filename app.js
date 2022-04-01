const bodyParser = require("body-parser");
const express = require("express");
const path = require('path');
const sharp = require('sharp');
const { S3 } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

// Change this to match your Backblaze B2 account
const ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';

const TN_SUFFIX = '_tn.jpg';

// Helper function to split an incoming path into the bucket
// and the remainder of the path
// e.g. '/my-bucket/path/to/image.png'
// is split into 'my-bucket' and 'path/to/image.png'
// URI-decodes path to handle keys with spaces
const splitPath = (fullpath) => {
  // Skip the initial '/'
  const index = fullpath.indexOf('/', 1);
  let bucket = null;
  let path = null;

  if (index === -1) {
    // There's no object key
    if (fullpath.length > 1) {
      // There's only a bucket name
      bucket = fullpath.substring(1);
    }
  } else {
    bucket = fullpath.substring(1, index);
    path = decodeURIComponent(fullpath.substring(index + 1));
  }

  return [bucket, path];
}

// Never, ever, ever put credentials in code!
require('dotenv').config();

// Extract region from ENDPOINT, as the S3 constructor requires it
const regionRegexp = /https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com/;
const match = ENDPOINT.match(regionRegexp);
const region = match[1];

// Create an S3 client object
const client = new S3({
  endpoint: ENDPOINT,
  region: region
});

// Set up Express
const router = express.Router();
const app = express();

app.use(bodyParser.json());

// Handle POST requests at /thumbnail
router.post('/thumbnail', async (request,response) => {

  // Extract the bucket and key from the incoming URL
  const inputUrl = new URL(request.body.url);
  const [bucket, key] = splitPath(inputUrl.pathname);

  // Only process images
  // Only operate on PUTs
  // Bucket and key must be present in the path
  // Don't process ACL, CORS etc PUTs (URL contains a '?')
  // Don't make thumbnails of thumbnails
  if (!request.body.contentType
    || !request.body.contentType.startsWith('image/')
    || request.body.method !== 'PUT'
    || !(bucket && key)
    || !request.body.url
    || request.body.url.indexOf('?') !== -1
    || request.body.url.endsWith(TN_SUFFIX)) {
    console.log(`Skipping ${JSON.stringify(request.body, null, 4)}`);
    response.sendStatus(204).end();
    return;    
  }

  try {
    // Get the image from B2 (returns a readable stream)
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

    // Remove any extension from incoming key and append '_tn.jpg'
    const outputKey = path.parse(key).name + TN_SUFFIX;
    const outputUrl = ENDPOINT + '/' + bucket + '/' + encodeURIComponent(outputKey);

    // Write the thumbnail buffer to B2
    console.log(`Writing thumbnail to ${outputUrl}`);
    await client.putObject({
      Bucket: bucket,
      Key: outputKey,
      Body: thumbnail,
      ContentType: 'image/jpeg'
    });

    // We're done - reply with the thumbnail's URL
    response.json({
      thumbnail: outputUrl
    });
  } catch (err) {
    console.log(err);
    response.sendStatus(500).end();
  }
});

app.use("/", router);

// Default to listen on 3000
const port = process.env.PORT || 3000;

app.listen(port,() => {
  console.log(`Listening on port ${port}`);
})
