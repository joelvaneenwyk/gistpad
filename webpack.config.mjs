// @ts-check

import { createRequire } from 'module';
import { resolve as _resolve, dirname, join } from "path";
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const CopyPlugin = require("copy-webpack-plugin");

/** @type { import('webpack').Configuration } */
const config = {
  mode: "production",
  entry: "./src/extension.ts",
  externals: {
    vscode: "commonjs vscode"
  },
  resolve: {
    fallback: {
      "string_decoder": require.resolve("string_decoder/"),
      "buffer": require.resolve("buffer/"),
      "child_process": false,
      "crypto": false,
      "fs": false,
      "events": require.resolve("events/"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify/browser"),
      "path": require.resolve("path-browserify"),
      "querystring": require.resolve("querystring-es3"),
      "stream": false,
      "url": require.resolve("url/"),
      "util": require.resolve("util/"),
      "zlib": false
    },
    extensions: [".ts", ".mjs", ".js", ".json"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader"
          }
        ]
      }
    ]
  }
};

const nodeConfig = {
  ...config,
  target: "node",
  output: {
    path: _resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    ...config.resolve,
    alias: {
      "@abstractions": join(__dirname, "./src/abstractions/node")
    }
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: _resolve(
            __dirname,
            "./src/abstractions/node/images/scripts/*"
          ),
          to: _resolve(__dirname, "./dist/scripts/"),
        }
      ],
    })
  ]
};

const webConfig = {
  ...config,
  target: "webworker",
  output: {
    path: _resolve(__dirname, "dist"),
    filename: "extension-web.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    ...config.resolve,
    alias: {
      "@abstractions": join(__dirname, "./src/abstractions/browser")
    },
  }
};

export default [nodeConfig, webConfig];
