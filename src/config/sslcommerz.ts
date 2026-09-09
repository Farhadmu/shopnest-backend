import axios from "axios";

const sslcommerz = axios.create({
  baseURL: process.env.SSLCOMMERZ_API_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
});

export default sslcommerz;