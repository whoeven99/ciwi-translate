/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly",
  },
  overrides: [
    {
      // translate-v4 创建任务等表面：禁止 Ant Select（嵌入页 + 自定义 CSS 易拆布局）
      files: ["app/routes/app.translate-v4/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "antd",
                importNames: ["Select"],
                message:
                  "Use InFlowSelect / chips / Combobox on translate-v4. Do not use Ant Select or Polaris Select inside AppSModal.",
              },
            ],
          },
        ],
      },
    },
  ],
};
