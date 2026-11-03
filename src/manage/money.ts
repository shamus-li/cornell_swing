const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
export const money = (dollars: number) => currency.format(dollars).replace("-", "−")
