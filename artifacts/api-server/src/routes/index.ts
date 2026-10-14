import { Router, type IRouter } from "express";
import healthRouter from "./health";
import productsRouter from "./products";
import checkoutRouter from "./checkout";
import scryfallRouter from "./scryfall";
import uploadRouter from "./upload";
import subscribersRouter from "./subscribers";
import shippingRouter from "./shipping";
import accountRouter from "./account";
import adminOrdersRouter from "./orders";
import labelsRouter from "./labels";

const router: IRouter = Router();

router.use(healthRouter);
router.use(productsRouter);
router.use(checkoutRouter);
router.use(scryfallRouter);
router.use(uploadRouter);
router.use(subscribersRouter);
router.use(shippingRouter);
router.use(accountRouter);
router.use(adminOrdersRouter);
router.use(labelsRouter);

export default router;
