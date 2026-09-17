import { Router } from "express";
import * as imageCtrl from "./image.controller";

const router = Router();

router.get("/resize", imageCtrl.resizeImage);

export default router;
