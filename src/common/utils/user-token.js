import JWT from "jsonwebtoken";
import { PUBLIC_KEY } from "./cert.js";

export function verifyToken(token) {
  return JWT.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] });
}
