import mongoose from 'mongoose';
import { env } from './env.js';

let connectionPromise;

export async function connectDatabase() {
  if (!env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  mongoose.set('strictQuery', true);
  connectionPromise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    .catch((error) => {
      connectionPromise = undefined;
      throw error;
    });
  await connectionPromise;
  console.log('MongoDB connected');
  return mongoose.connection;
}
