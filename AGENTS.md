# Project Instructions: Water and LPG Cylinder Distribution, Inventory, Accounting, and PWA Application

## 1. Project Purpose

Build a secure, reliable distribution tracking, inventory management, and accounting application for a company that distributes products such as returnable water jugs (damacana), LPG cylinders (tüp), PET bottled water (Pet Su), cardboard cups (karton bardak), plastic cups (plastik bardak), and other configurable products.

The application must manage warehouse inventory, morning vehicle loading, daily deliveries, customer accounts, customer debts, returnable item tracking, payment collection, driver accountability, end-of-day reports, and operational history.

The application must be responsive, mobile-first, and installable as a Progressive Web App (PWA).

**The entire user-facing application must be in Turkish.** All menus, buttons, labels, forms, notifications, validation messages, reports, tables, dashboards, loading states, and error messages must use correct Turkish terminology and characters (ç, ğ, ı, İ, ö, ş, ü). No English text should appear in the user interface, except where technically necessary for non-user-facing identifiers.

Prioritize data integrity, usability, mobile accessibility, secure role-based access control, and reliable offline behavior where supported.

## 2. User Roles and Permissions

The application must implement role-based access control with at least two roles: Warehouse Manager (Depo Yöneticisi) and Driver (Şoför).

### 2.1. Warehouse Manager (Depo Yöneticisi)

The warehouse manager is responsible for managing warehouse operations and supervising the entire distribution team.

The warehouse manager must be able to:

- Manage warehouse inventory, products, drivers, customers, and operational records.
- Create, edit, and deactivate product definitions as appropriate.
- Manage customer records and view customer account balances and transaction histories.
- Select the driver authorized to perform each distribution run.
- Select the vehicle license plate during morning loading.
- Record and authorize warehouse stock additions, removals, and inventory adjustments.
- Supervise morning vehicle loading and verify the quantities loaded onto each vehicle.
- Review delivery records, customer payments, outstanding debts, returned products, and returnable item quantities.
- View the activity and distribution runs of all drivers.
- Review and authorize end-of-day reports and investigate discrepancies.
- Manage the distribution team's daily operations.

The warehouse manager must not perform deliveries or operate as a delivery driver. The manager's role is to manage, supervise, and authorize operations.

### 2.2. Driver (Şoför)

Drivers can perform distribution operations only when authorized or selected by the warehouse manager.

Drivers must be able to:

- View their assigned distribution run, selected vehicle license plate, and loaded products.
- View available vehicle stock during distribution.
- Record customer visits and delivered products.
- Record undelivered products and product returns.
- Record payments received from customers, including full and partial payments.
- Record returnable items left with customers and collected from customers.
- View the customer information and outstanding balances necessary for their assigned deliveries.
- Complete end-of-day reconciliation and submit the distribution report.

Drivers must not be able to:

- Manage other drivers or user roles.
- Change company-wide settings or authorization rules.
- Make unauthorized warehouse inventory adjustments.
- Access or modify distribution runs assigned to other drivers.
- Alter confirmed historical transactions without an authorized correction process.
- Start a new distribution run before their previous run has been successfully finalized.

All permissions must be enforced on the server side and, where applicable, through database authorization policies. Hiding buttons or menu items in the user interface is not sufficient.

## 3. Product Management and Product Categories

The system must support configurable products and distinguish between ordinary saleable products and returnable items.

### 3.1. Saleable Products

Examples include:

- Damacana su
- Tüp
- Pet su
- Karton bardak
- Plastik bardak
- Soda
- Gazoz
- Other products that may be added in the future

Each product must have configurable properties, including:

- Product name
- Product category
- Unit of measurement, such as piece, package, or box
- Sale price
- Active or inactive status
- Inventory tracking settings
- Whether the product is returnable or associated with customer-held equipment

Product types, prices, and categories must not be permanently hardcoded. Authorized users must be able to manage product definitions through the application.

### 3.2. Returnable Items and Customer-Held Equipment

The system must separately track returnable items and equipment that remain with customers.

Examples include:

- Empty water jugs (boş damacana)
- LPG cylinders, where applicable to the company's return and exchange process
- Water dispensers (sebil)
- Other configurable returnable containers or equipment

The application must distinguish between a product sold to a customer and an item or piece of equipment left with the customer and expected to be returned.

**No monetary deposit tracking is required.** The system must not calculate, record, or report monetary deposit charges, deposit refunds, or outstanding monetary deposit balances.

Only the quantities of returnable items left with customers, collected from customers, and currently outstanding must be tracked.

## 4. Morning Vehicle Loading Process (Sabah Araç Yüklemesi)

Every distribution run must begin with an authorized vehicle loading process.

1. The warehouse manager selects the driver who will perform the distribution.
2. The warehouse manager enters or selects the vehicle license plate for that run.
3. The warehouse manager records the products and quantities loaded onto the vehicle.
4. The system checks that the warehouse has sufficient stock.
5. The warehouse manager confirms the loading operation.
6. Once confirmed, warehouse stock decreases and vehicle stock increases by the corresponding quantities.
7. The system records the date, driver, license plate, products, quantities, and the user who authorized the loading.

Vehicle license plates must be dynamic. They must not be hardcoded or permanently assigned to a particular driver. The warehouse manager must be able to enter or select the plate during the loading process.

The system must maintain an auditable record of every loading operation. Confirmed loading records must not be silently overwritten or deleted.

A driver must not be allowed to start distribution without an authorized and confirmed loading record.

## 5. Distribution Run and Delivery Workflow

The application must enforce the following operational sequence:

**Warehouse Preparation → Driver and Vehicle Selection → Vehicle Loading → Distribution → End-of-Day Reconciliation → Report Submission → Run Finalization → Next Distribution Run**

Each distribution run must have a unique identifier and a clearly defined status.

Suggested Turkish statuses include:

- Hazırlanıyor
- Yükleme Bekleniyor
- Dağıtıma Hazır
- Dağıtımda
- Gün Sonu İşlemleri Bekleniyor
- Raporlandı
- Kapatıldı

Status transitions must be validated by the application's business logic and database operations, not controlled solely by the user interface.

During distribution:

- The driver records each customer visit and delivery.
- Delivered quantities are deducted from vehicle stock.
- Undelivered products remain accounted for.
- Returned saleable products are recorded with the reason and appropriate inventory treatment.
- Payments are recorded against the relevant customer and, where applicable, the corresponding sale or delivery.
- Returnable items left with customers are recorded separately from ordinary product sales.
- Empty containers and other returnable items collected from customers are recorded by type and quantity.
- The system prevents deliveries exceeding the available vehicle stock unless an explicitly authorized correction process applies.

All inventory movements and customer transactions must be traceable to the relevant distribution run.

## 6. Customer Debt and Account Balance Tracking

The system must maintain an accurate financial account for every customer.

Customers may normally pay at the time of delivery, but the system must also support unpaid sales, partial payments, and payments collected during subsequent visits.

For each customer, the system must record:

- Products delivered and their sale prices.
- Total sales amount.
- Payments received.
- Outstanding debt balance.
- Partial payments and payments collected later.
- Authorized credits, refunds, and financial adjustments, where applicable.
- Transaction dates and relevant distribution references.
- A complete and traceable account history.

The customer's outstanding debt must be calculated from recorded sales, payments, and authorized financial adjustments.

**Example:**

A customer receives products worth TRY 1,000 and pays TRY 700.

- Total sale: TRY 1,000
- Payment received: TRY 700
- Outstanding customer debt: TRY 300

When the customer later pays the remaining TRY 300, the outstanding debt must automatically decrease to zero.

A sale must not be marked as fully paid unless the full payment has actually been recorded.

The system must support full payments, partial payments, and payments collected during subsequent customer visits. Each payment must be linked to the correct customer and, where applicable, the relevant sale or outstanding account balance.

The warehouse manager must be able to view each customer's current debt balance, payment history, unpaid sales, and account statement.

The system must clearly distinguish between sales revenue, payments received, and outstanding customer debt. These values must not be treated as interchangeable.

## 7. Customer Returnable Item and Equipment Tracking

The system must maintain a separate quantity balance for returnable items and equipment held by each customer.

Examples include empty water jugs, LPG cylinders where applicable, water dispensers, and other configurable returnable items.

For each customer and each returnable item type, the system must track:

- The quantity of items left with the customer.
- The quantity collected or returned by the customer.
- The current quantity remaining with the customer.
- Any authorized quantity corrections and their reasons.
- The complete history of items delivered, left with, collected from, or otherwise adjusted for the customer.

The system must calculate the current quantity automatically:

**Current Quantity with Customer = Total Quantity Left with Customer − Total Quantity Returned or Collected from Customer ± Authorized Adjustments**

**Example:**

- 10 empty water jugs are left with a customer.
- 2 water dispensers are also left with the customer.
- The customer later returns 4 empty water jugs and 1 water dispenser.

The system must show:

- Empty water jugs remaining with the customer: 6
- Water dispensers remaining with the customer: 1

Balances must be maintained separately for each item type. Different returnable items must never be combined into a single quantity.

Returnable item quantities must be tracked independently of the customer's financial balance.

For example, a customer may owe TRY 500 while having 3 empty water jugs and 1 water dispenser outstanding. The application must display the monetary debt and item quantities separately.

The warehouse manager must be able to review each customer's outstanding returnable item quantities at any time.

Drivers must be able to record items left with customers and items collected from them during their assigned distribution runs.

The system must not create monetary deposit transactions when returnable items are delivered or collected.

## 8. Inventory Management and Stock Integrity

The application must maintain consistent inventory records across the warehouse, vehicles, customers, and distribution transactions.

The system must:

- Track warehouse stock by product.
- Track vehicle stock by distribution run and product.
- Deduct confirmed vehicle loading quantities from warehouse stock.
- Deduct delivered products from vehicle stock.
- Record returned or undelivered products with the correct stock treatment.
- Track returnable items separately from ordinary saleable product quantities where their operational roles differ.
- Prevent stock from becoming negative unless a specifically authorized business rule permits it.
- Record every stock movement with its date, quantity, source, destination, reason, and responsible user.
- Maintain a historical record of inventory movements.
- Prevent duplicate processing of loading, delivery, return, or stock adjustment transactions.
- Use database transactions and appropriate constraints to prevent inconsistent inventory updates, including those caused by concurrent operations.

Confirmed transactions must not be silently overwritten or deleted. Corrections must be handled through an authorized and auditable process.

## 9. Mandatory End-of-Day Report (Gün Sonu Raporu)

At the end of every distribution run, the driver must complete the end-of-day reconciliation and submit a report.

The report must include, at minimum:

- Distribution date and run identifier.
- Driver and vehicle license plate.
- Opening vehicle stock and quantities loaded.
- Quantities delivered by product.
- Undelivered and returned product quantities.
- Total sales amount.
- Payments collected from customers.
- Outstanding debts created or remaining after deliveries.
- Customer account transactions recorded during the run.
- Returnable items left with customers.
- Returnable items collected from customers.
- Closing vehicle stock.
- Cash collected and other supported payment methods.
- Any stock, cash, or transaction discrepancies.
- Explanations for discrepancies that require clarification.

The system must validate the report before submission.

If stock quantities, payment totals, or other required figures do not reconcile, the application must identify the discrepancy and require an explanation or authorized resolution according to the company's configured rules.

The report must accurately distinguish between total sales, payments collected, and outstanding customer debt. Unpaid sales must not be counted as collected cash.

The report must also reconcile the vehicle's opening stock, loading, deliveries, returns, and closing stock.

Once the report has been submitted and the distribution run has been successfully finalized, the run must be marked as closed.

The driver must not be allowed to start another distribution run until the previous run has been reconciled, its end-of-day report has been submitted successfully, and the run has been finalized.

The system must prevent duplicate active runs for the same driver.

Submitted reports and finalized runs must remain available for historical review. Corrections must follow an authorized, auditable process rather than silently changing historical records.

## 10. Customer Account Statements and Operational Reports

The warehouse manager must be able to access reports that support daily operations and customer account management.

### 10.1. Customer Account Statement

For a selected customer and date range, the system should display:

- Opening customer debt balance.
- Products delivered and their prices.
- Total sales.
- Payments received.
- Partial and subsequent payments.
- Authorized credits, refunds, and adjustments.
- Closing outstanding debt balance.
- Current returnable item quantities by item type.
- Historical quantities left with and collected from the customer.

The customer's financial balance and returnable item quantities must always be displayed separately.

### 10.2. Warehouse and Distribution Reports

The system should also provide:

- Current warehouse stock.
- Current vehicle stock and loading history.
- Daily sales and payment collection reports.
- Outstanding customer debt reports.
- Returnable item balances by customer.
- Driver activity and distribution run reports.
- End-of-day reconciliation reports.
- Stock discrepancy and transaction history reports.

Reports must use Turkish labels, correct monetary formatting in Turkish lira (TRY), and appropriate date and number formats for Turkish users.

## 11. Responsive Design and Mobile Usability

The application must provide a fully responsive, mobile-first user interface that works correctly on mobile phones, tablets, laptops, and desktop computers.

**On mobile screens, the entire application must scroll vertically only. Horizontal scrolling must not be required to navigate pages or view ordinary application content.**

Implement the following requirements:

- Prevent horizontal page overflow on mobile devices.
- Ensure that page layouts, forms, cards, navigation menus, buttons, dialogs, and dashboards fit within the available viewport width.
- Use responsive layouts that adapt to small screens without forcing desktop-sized content onto mobile devices.
- Stack form fields and content sections vertically when horizontal space is limited.
- Ensure all buttons, inputs, dropdowns, and other interactive controls remain usable on touchscreens.
- Use readable font sizes and adequate spacing between interactive elements.
- Make tables responsive. On small screens, transform wide tables into stacked records or cards, or use another mobile-friendly layout that keeps all essential information accessible without requiring horizontal page scrolling.
- Prevent long product names, customer names, addresses, and transaction descriptions from expanding the page beyond the viewport.
- Ensure dialogs, confirmation windows, dropdown menus, and forms remain within the visible screen area and can be used on mobile devices.
- Keep navigation usable on small screens, using an appropriate compact menu or drawer when necessary.
- Ensure the virtual keyboard does not make important form actions inaccessible.
- Avoid fixed-width layouts and components that cause horizontal overflow.
- Support portrait and landscape orientations.
- Test the application at common mobile viewport widths, including approximately 320px, 360px, 375px, 390px, and 430px.

Do not solve horizontal overflow by merely hiding content that users need. Adapt the layout so all essential information and actions remain accessible.

The primary mobile interaction pattern must be vertical scrolling. Individual controls should not introduce unnecessary horizontal scrolling, and users must not need to swipe sideways to operate the application.

## 12. Progressive Web App (PWA) Requirements

The application must be implemented as a Progressive Web App (PWA), allowing users to install it on supported mobile devices and desktop browsers.

Implement the following PWA capabilities:

### 12.1. Installability

- Provide a valid web app manifest.
- Configure the application name and short name in Turkish.
- Include appropriate application icons in the required sizes.
- Configure the theme color and background color.
- Set the display mode to `standalone` where supported.
- Configure the start URL and application scope correctly.
- Ensure the application can be installed through supported browsers and operating systems.
- Provide a consistent app-like experience when launched from the home screen.

### 12.2. Service Worker and Caching

- Implement a service worker using a reliable, maintained PWA approach compatible with the project's framework and build tools.
- Cache the essential application shell and static assets so the interface can load during temporary network interruptions.
- Use appropriate caching strategies for static assets and application data.
- Avoid serving stale or unauthorized customer financial information to the wrong user.
- Handle application updates safely and notify users in Turkish when an update requires refreshing or restarting the application.
- Ensure service worker registration and production deployment work correctly.

### 12.3. Offline and Unstable Network Behavior

The application should handle temporary loss of connectivity gracefully.

- Clearly indicate the current connection and synchronization status in Turkish.
- Allow cached application screens and previously retrieved, authorized data to remain accessible when offline where technically and securely appropriate.
- If offline transaction entry is implemented, store pending transactions locally using an appropriate persistent storage mechanism.
- Mark unsynchronized transactions clearly and show whether each transaction is pending, synchronized, or failed.
- Synchronize pending transactions with the server when connectivity returns.
- Prevent duplicate processing when a transaction is retried.
- Detect conflicting updates and provide a safe resolution process.
- Do not report a transaction as successfully synchronized until the server confirms that it has been persisted.
- Do not silently discard locally stored transactions.
- Protect locally cached customer data and clear user-specific data appropriately when a user signs out or loses authorization.

The application must not pretend that offline changes are already reflected in the central database.

Because inventory, customer debts, payments, and distribution runs affect accounting, the system must define safe rules for offline transactions. Transactions that require current stock or server-side authorization must be validated when synchronized. Conflicts must be flagged for resolution rather than silently overwriting existing records.

Offline support must be implemented according to the actual capabilities of the project's architecture. Do not claim full offline functionality unless the required local storage, synchronization, conflict handling, and authorization safeguards are implemented and tested.

### 12.4. PWA Security and Compatibility

- Do not expose privileged database keys or secrets in the client.
- Use HTTPS in production.
- Ensure authentication and role-based authorization remain enforced when the application is launched as an installed PWA.
- Handle expired sessions, sign-out, and revoked access safely.
- Test the PWA on supported Android browsers and desktop browsers, and on iOS where supported.
- Ensure that installation, navigation, caching, synchronization, and application updates work in the production environment.

## 13. Security, Audit Trail, and Data Integrity

The application must enforce all important permissions and business rules on the server side and, where applicable, in the database.

The system must:

- Authenticate users and enforce role-based authorization.
- Ensure drivers can access only the records and operations permitted for their assigned distribution runs.
- Restrict warehouse-wide management and authorization functions to the warehouse manager.
- Validate stock availability before confirming loading and delivery transactions.
- Validate customer payment amounts and update account balances consistently.
- Maintain accurate returnable item quantities for each customer.
- Record who performed important operations and when they occurred.
- Preserve historical transactions and submitted reports.
- Use appropriate database transactions, constraints, and authorization policies.
- Prevent duplicate or conflicting operations.
- Confirm successful database operations before displaying success messages.
- Avoid exposing sensitive credentials or privileged database keys in client-side code.
- Protect locally cached and offline data according to the user's authorization level.

Hiding an action in the interface is not sufficient to secure it. Unauthorized requests must also be rejected by the server or database.

## 14. General Development Requirements

- Keep the entire user-facing application in Turkish.
- Use clear and consistent Turkish terminology across all screens and reports.
- Separate the user interface, business logic, and database operations.
- Make products, product categories, drivers, customers, vehicle license plates, and relevant operational settings configurable.
- Avoid hardcoding business data that should be managed by authorized users.
- Preserve historical data and provide an audit trail for important transactions.
- Prioritize usability for warehouse staff and drivers during daily distribution operations.
- Implement and validate business rules at the appropriate application and database layers.
- Do not invent additional business rules when a requirement is unclear. Ask for clarification before implementing decisions that could affect inventory, customer debt, returnable item balances, or accounting.
- Do not treat a successful user-interface interaction as proof that a database operation succeeded.
- Ensure calculations are based on confirmed and traceable transactions.
- Verify that the application works correctly on small screens without horizontal page scrolling.
- Verify PWA installation, service worker behavior, and supported offline capabilities in the production environment.
- Avoid adding unnecessary libraries when existing project dependencies can safely provide the required functionality.
- Preserve existing working features when implementing new requirements.

## 15. Critical Business Rules

The following rules are mandatory and must not be bypassed:

1. Only the warehouse manager can authorize warehouse operations and select the driver for a distribution run.
2. The warehouse manager supervises the team and does not perform deliveries.
3. Every distribution run requires an authorized driver, a dynamically selected vehicle license plate, and a confirmed loading record.
4. Warehouse and vehicle stock must be updated consistently for every confirmed stock movement.
5. A driver cannot start a new distribution run until the previous run has been reconciled, its end-of-day report has been submitted, and the run has been successfully finalized.
6. Customer debt balances must be based on recorded sales, payments, and authorized financial adjustments.
7. Customer returnable item balances must be tracked separately by customer and item type.
8. Returnable item tracking is based on quantities only. Monetary deposit charges, refunds, and balances must not be implemented.
9. Customer financial debt and outstanding returnable item quantities must never be combined into a single balance.
10. All important operations must be traceable, and historical records must not be silently overwritten or deleted.
11. On mobile devices, the application must be navigable through vertical scrolling without horizontal page scrolling.
12. The application must be installable as a PWA on supported platforms.
13. Offline transaction support must never falsely indicate that a transaction has been synchronized or confirmed by the server.
14. All user-facing text, including PWA installation guidance, connection status, synchronization messages, and error notifications, must be in Turkish.

## 16. Overall Objective

Build a secure, reliable, Turkish-language distribution and accounting application that enables the warehouse manager to control inventory and the distribution team, allows authorized drivers to manage their assigned deliveries, accurately tracks customer debts and returnable item quantities, and enforces mandatory end-of-day reconciliation before another distribution run can begin.

The application must provide a mobile-friendly experience with vertical scrolling, no unnecessary horizontal page overflow, and PWA installation support. Offline access and synchronization must be implemented carefully so that stock, customer balances, payments, and historical records remain consistent and trustworthy.

## 17. Supabase Configuration and Backend Preservation

The existing Supabase configuration is critical to ongoing development. You must preserve the current Supabase setup so that the application can continue communicating with the backend throughout the development process.

The following requirements are mandatory:

- **Do not modify, replace, reset, or remove the existing Supabase project configuration.**
- Do not change the existing Supabase project URL, project reference, API keys, environment variable names, or environment variable configuration.
- Do not disconnect the application from its existing Supabase project or switch it to a different Supabase project, database, or backend environment.
- Do not overwrite, delete, recreate, or reset existing database tables, schemas, records, authentication settings, Row Level Security (RLS) policies, database functions, triggers, or other Supabase resources.
- Do not modify Supabase authentication providers, redirect URLs, session settings, or authorization configuration unless explicitly requested.
- Do not disable RLS or weaken existing database permissions to make development easier.
- Do not expose, print, commit, or hardcode Supabase credentials, service-role keys, or other secrets in client-side code or source control.
- Preserve the existing environment variables and `.env` files. Do not replace valid configuration with placeholder values or example credentials.
- Do not run destructive database commands, migrations, seed scripts, or automated setup procedures that could reset or overwrite existing data.
- Before making any backend-related changes, inspect the existing Supabase integration, database schema, authorization policies, and application data flow.
- Continue using the existing Supabase backend for development, testing, and verification. Changes to the application must remain compatible with the currently configured backend.
- When new functionality requires database changes, prefer backward-compatible, non-destructive changes. Explain the proposed changes and their impact before applying any schema, policy, function, or trigger modifications that could affect existing data or operations.
- Do not apply database migrations or modify production data without explicit authorization.
- Preserve the existing connection between the frontend and Supabase so that authentication, database queries, inserts, updates, and other supported backend operations continue working during development.
- After implementing changes, verify that the application can still connect to the existing Supabase project and that the relevant backend operations work correctly.

**Primary objective:** Continue developing and improving the application while preserving the existing Supabase configuration, backend connectivity, database contents, authentication, and authorization rules. Do not sacrifice the ability to communicate with the existing backend in order to implement a new feature or improve the user interface.