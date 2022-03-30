const bodyParser = require("body-parser");
const express = require("express");
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { S3 } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

const ENDPOINT = 'https://s3.us-west-004.backblazeb2.com';

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

const tmpFilename = () => {
  return path.join(os.tmpdir(), uuidv4());
}

router.post('/',async (request,response) => {
  // Extract the bucket and key from the incoming URL
  const inputUrl = new URL(request.body.url);
  const [bucket, key] = splitPath(inputUrl.pathname);

  let filename = null;

  try {
    // Create a Sharp transformer into which we can stream image data
    const transformer = sharp()
      .rotate()
      .resize(240)
      .jpeg();

    // Get a readable stream for the image
    const obj = await client.getObject({
      Bucket: bucket,
      Key: key
    });

    // Need to stream transformer output to a local file, since we 
    // can't do putObject() without the content length
    filename = tmpFilename();

    console.log(`Streaming image from ${inputUrl}, through transformer, into ${filename}`);

    // Pipe the object through the transformer into the tmp file
    // and wait until it's all done
    await new Promise((resolve, reject) => {
      const pipe = obj.Body.pipe(transformer).pipe(fs.createWriteStream(filename));
      pipe.on('error', reject);
      pipe.on('close', resolve);
    })

    const outputKey = `${path.parse(key).name}_tn.jpg`;
    const outputUrl = path.join(ENDPOINT, bucket, outputKey);
    console.log(`Writing thumbnail to ${outputUrl}`);

    await client.putObject({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filename)
    });

    response.json({
      url: outputUrl
    });
  } catch (err) {
    console.log(err);
    response.sendStatus(500).end();    
  } finally {
    if (filename) {
      fs.unlinkSync(filename);
      console.log(`Deleted ${filename}`);      
    }
  }
});

app.use("/", router);

const port = process.env.PORT || 3000;

app.listen(port,() => {
  console.log(`Listening on port ${port}`);
})
