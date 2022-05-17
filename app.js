const bodyParser = require("body-parser");
const express = require("express");
const sharp = require('sharp');
const { S3 } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

// Never, ever, ever put credentials in code!
require('dotenv').config();

// Read configuration from the environment
const B2_ENDPOINT = process.env.B2_ENDPOINT;
const RESIZE_OPTIONS = JSON.parse(process.env.RESIZE_OPTIONS);

const TN_SUFFIX = '_tn';

// Helper function to split an incoming path into the bucket,
// the remainder of the path (excluding any extension) and the
// extension (if present).
// e.g. '/my-bucket/path/to/image.png'
// is split into 'my-bucket', 'path/to/image' and 'png'
// URI-decodes path to handle keys with spaces
const splitPath = (fullpath) => {
  // Skip the initial '/' to find separator between bucket and key
  const separator = fullpath.indexOf('/', 1);
  let bucket = null, basePath = null, extension = null;

  if (separator === -1) {
    // There's no object key
    if (fullpath.length > 1) {
      // There's only a bucket name
      bucket = fullpath.substring(1);
    }
  } else {
    bucket = fullpath.substring(1, separator);
    const path = decodeURIComponent(fullpath.substring(separator + 1));
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) {
      basePath = path;
    } else {
      basePath = path.substring(0, lastDot);
      extension = path.substring(lastDot + 1)      
    }
  }

  return [bucket, basePath, extension];
}

// Extract region from B2_ENDPOINT, as the S3 constructor requires it
const regionRegexp = /https:\/\/s3\.([a-z0-9-]+)\.backblazeb2\.com/;
const match = B2_ENDPOINT.match(regionRegexp);
const region = match[1];

// Create an S3 client object
const client = new S3({
  endpoint: B2_ENDPOINT,
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
  const [bucket, keyBase, extension] = splitPath(inputUrl.pathname);

  // Only process images
  // Only operate on PUTs
  // Bucket and key must be present in the path
  // Don't process ACL, CORS etc PUTs (URL contains a '?')
  // Don't make thumbnails of thumbnails
  if (!request.body.contentType
    || !request.body.contentType.startsWith('image/')
    || request.body.method !== 'PUT'
    || !(bucket && keyBase)
    || !request.body.url
    || request.body.url.indexOf('?') !== -1
    || keyBase.endsWith(TN_SUFFIX)) {
    console.log(`Skipping ${JSON.stringify(request.body, null, 4)}`);
    response.sendStatus(204).end();
    return;    
  }

  try {
    // Get the image from B2 (returns a readable stream as the body)
    console.log(`Fetching image from ${inputUrl}`);
    const obj = await client.getObject({
      Bucket: bucket,
      Key: keyBase + (extension ? "." + extension : "")
    });

    // Create a Sharp transformer into which we can stream image data
    const transformer = sharp()
      .rotate()                // Auto-orient based on the EXIF Orientation tag
      .resize(RESIZE_OPTIONS); // Resize according to configured options

    // Pipe the image data into the transformer
    obj.Body.pipe(transformer);

    // We can read the transformer output into a buffer, since we know 
    // that thumbnails are small enough to fit in memory
    const thumbnail = await transformer.toBuffer();

    // Remove any extension from the incoming key and append '_tn.<extension>'
    const outputKey = keyBase + TN_SUFFIX + (extension ? "." + extension : "");
    const outputUrl = B2_ENDPOINT + '/' + bucket + '/' 
                        + encodeURIComponent(outputKey);

    // Write the thumbnail buffer to the same B2 bucket as the original
    console.log(`Writing thumbnail to ${outputUrl}`);
    await client.putObject({
      Bucket: bucket,
      Key: outputKey,
      Body: thumbnail,
      ContentType: request.body.contentType
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
