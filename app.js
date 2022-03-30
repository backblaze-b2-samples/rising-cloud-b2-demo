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

const downloadToTmp = async (bucket, key) => {
  // Create a writeable stream to a temporary file
  const filename = tmpFilename();
  const file = fs.createWriteStream(filename);

  // Get a readable stream for the object
  const obj = await client.getObject({
    Bucket: bucket,
    Key: key
  });

  // Pipe the object into the temporary file
  const pipe = obj.Body.pipe(file);

  return new Promise((resolve, reject) => {
    pipe.on('error', reject);
    pipe.on('close', () => {
      resolve(filename);
    });
  });
}

const upload = (filename, bucket, key) => {
  return client.putObject({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(filename)
  });
}

router.post('/',async (request,response) => {
  // Extract the bucket and key from the incoming URL
  const inputUrl = new URL(request.body.url);
  const [bucket, key] = splitPath(inputUrl.pathname);

  let inputFilename = null;
  let outputFilename = null;

  try {
    console.log(`Downloading image from ${inputUrl}`);

    inputFilename = await downloadToTmp(bucket, key);
    console.log(`Wrote image to ${inputFilename}`);

    outputFilename = tmpFilename();
    const result = await sharp(inputFilename)
      .rotate()
      .resize(240)
      .jpeg()
      .toFile(outputFilename);
    console.log(`Resized image to ${outputFilename}`);

    const outputKey = `${path.parse(key).name}_tn.jpg`;
    await upload(outputFilename, bucket, outputKey);

    const outputUrl = path.join(ENDPOINT, bucket, outputKey);
    console.log(`Uploaded thumbnail to ${outputUrl}`);

    response.json({
      url: outputUrl
    });
  } catch (err) {
    console.log(err);
    response.sendStatus(500).end();    
  } finally {
    if (inputFilename) {
      fs.unlinkSync(inputFilename);
      console.log(`Deleted ${inputFilename}`);      
    }
    if (outputFilename) {
      fs.unlinkSync(outputFilename);
      console.log(`Deleted ${outputFilename}`);      
    }
  }
});

app.use("/", router);

const port = process.env.PORT || 3000;

app.listen(port,() => {
  console.log(`Listening on port ${port}`);
})
