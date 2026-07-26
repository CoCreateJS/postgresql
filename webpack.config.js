import webpack from "webpack";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EsbuildPlugin } from "esbuild-loader";
import { FileUploader } from "@cocreate/webpack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async (env, argv) => {
    const isProduction = argv && argv.mode === "production";

    const config = {
        // Target Node.js runtime environment for Worker Threads execution
        target: "node",

        // Entry point for the PostgreSQL database adapter
        entry: {
            "postgresql": "./src/index.js"
        },

        output: {
            path: path.resolve(__dirname, "dist"),
            // Produces 'postgresql.bundle.js'
            filename: "[name].bundle.js",
            libraryTarget: "commonjs",
            clean: true,
            // Retain standard Node.js global context inside workers
            globalObject: "this"
        },

        node: {
            __dirname: false,
            __filename: false
        },

        plugins: [
            // Ignore optional native C++ bindings (pg-native) so pg falls back to pure JS
            new webpack.IgnorePlugin({
                resourceRegExp: /^(pg-native)$/
            }),
            // Uploads bundled driver script to CDN/HTTP endpoint if configured
            new FileUploader(env, argv)
        ],

        mode: isProduction ? "production" : "development",
        devtool: isProduction ? "source-map" : "eval-source-map",

        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    use: {
                        loader: "esbuild-loader",
                        options: {
                            loader: "js",
                            target: "node18"
                        }
                    }
                }
            ]
        },

        optimization: {
            minimize: isProduction,
            minimizer: [
                new EsbuildPlugin({
                    target: "node18"
                })
            ],
            // Enforce single-file output by disabling chunk splitting
            splitChunks: false,
            runtimeChunk: false
        },

        performance: {
            hints: isProduction ? "warning" : false
        }
    };

    return config;
};