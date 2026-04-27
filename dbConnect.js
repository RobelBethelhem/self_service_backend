
import mongoose from "mongoose";

const dbConnect = () =>{
    mongoose.connect(process.env.DB);
    mongoose.connection.on("connected", ()=>{
        console.log("Connected to MongoDB");
    });
    mongoose.connection.on('error', (err)=>{
        console.log(`MongoDB error ${err}`);
    });
    mongoose.connection.on("disconnected",()=>{
        console.log("Disconnected from MongoDB");
    });
}

export default dbConnect;