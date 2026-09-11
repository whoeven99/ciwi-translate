import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
} from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";
import { isProductionNodeEnv } from "~/config/nodeEnv.server";
import { globalStore } from "~/globalStore";
import { SHOPIFY_APP_STORE_LISTING_URL } from "~/lib/shopifyAppHandle.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

function shopFromSearch(request: Request): string {
  return new URL(request.url).searchParams.get("shop")?.trim() ?? "";
}

async function shopFromForm(request: Request): Promise<string> {
  const formData = await request.clone().formData();
  return String(formData.get("shop") ?? "").trim();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (isProductionNodeEnv() && !shopFromSearch(request)) {
    throw redirect(SHOPIFY_APP_STORE_LISTING_URL);
  }

  const errors = loginErrorMessage(await login(request));

  return json({ errors, polarisTranslations });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (isProductionNodeEnv() && !(await shopFromForm(request))) {
    throw redirect(SHOPIFY_APP_STORE_LISTING_URL);
  }

  const errors = loginErrorMessage(await login(request));

  return json({
    errors,
  });
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;
  const fetcher = useFetcher<any>();

  useEffect(() => {
    fetcher.submit(
      {
        log: `${globalStore?.shop} 跳转到了Login页面 ( warning )`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  }, []);

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
