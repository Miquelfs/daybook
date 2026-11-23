import { passthrough } from "@/lib/passthrough";

export const { GET, POST, PATCH, PUT, DELETE } = passthrough("/money/statements");
