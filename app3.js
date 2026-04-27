import express from "express";
import { config } from "dotenv";
import dbConnect from "./dbConnect.js";
import userRoutes from "./routes/auth.js";
import cors from "cors";


const app = express();
app.use(cors());

config();
dbConnect();

app.use(express.json()); // Parse incoming requests data

// Load the pre-trained models
Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromDisk(path.resolve('models')),
  faceapi.nets.faceLandmark68Net.loadFromDisk(path.resolve('models')),
  faceapi.nets.faceRecognitionNet.loadFromDisk(path.resolve('models')),
  faceapi.nets.faceExpressionNet.loadFromDisk(path.resolve('models')),
]).then(() => {
  console.log('Models loaded');
});

// Define the image paths
const imagePath1 = 'http://images4.fanpop.com/image/photos/16900000/Jennifer-Lopez-jennifer-lopez-16943927-1280-1652.jpg';
const imagePath2 = 'https://www.theplace2.ru/archive/jennifer_lopez/img/ghrmf9xtybo(2).jpg';


// Read the images from the provided paths
const image1 = await faceapi.fetchImage(imagePath1);
const image2 = await faceapi.fetchImage(imagePath2);

// Detect faces in the images
const detections1 = await faceapi.detectAllFaces(image1).withFaceLandmarks().withFaceDescriptors();
const detections2 = await faceapi.detectAllFaces(image2).withFaceLandmarks().withFaceDescriptors();

// Calculate the face distance between the two images
const distance = faceapi.euclideanDistance(
  detections1[0].descriptor,
  detections2[0].descriptor
);

console.log("Distance:", distance);

app.use("/api/users", userRoutes);

const port = process.env.PORT || 8081;

app.listen(port, () => console.log(`Listening on Port ${port}...`));