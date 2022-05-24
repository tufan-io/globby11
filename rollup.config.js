import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/index.js",
  output: {
    dir: "dist",
    format: "commonjs",
  },
  plugins: [
    commonjs(),
    nodeResolve(),
  ],
};
