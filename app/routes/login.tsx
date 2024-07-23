import {
	type ActionFunctionArgs,
	json,
	redirect,
	type HeadersFunction,
	type LoaderFunctionArgs,
	type MetaFunction,
} from '@remix-run/node'
import { Form, useLoaderData } from '@remix-run/react'
import * as React from 'react'
import invariant from 'tiny-invariant'
import { Button, LinkButton } from '#app/components/button.tsx'
import { Input, InputError, Label } from '#app/components/form-elements.tsx'
import { Grid } from '#app/components/grid.tsx'
import { HeroSection } from '#app/components/sections/hero-section.tsx'
import { Paragraph } from '#app/components/typography.tsx'
import { getConvertKitSubscriber } from '#app/convertkit/convertkit.server.ts'
import { getGenericSocialImage, images } from '#app/images.tsx'
import { type RootLoaderType } from '#app/root.tsx'
import { getLoginInfoSession } from '#app/utils/login.server.ts'
import {
	getDisplayUrl,
	getDomainUrl,
	getErrorMessage,
	getOrigin,
	getUrl,
	reuseUsefulLoaderHeaders,
} from '#app/utils/misc.tsx'
import { prisma } from '#app/utils/prisma.server.ts'
import { getSocialMetas } from '#app/utils/seo.ts'
import { getUser, sendToken } from '#app/utils/session.server.ts'
import { verifyEmailAddress } from '#app/utils/verifier.server.ts'

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getUser(request)
	if (user) return redirect('/me')

	const loginSession = await getLoginInfoSession(request)

	const headers = new Headers({
		'Cache-Control': 'private, max-age=3600',
		Vary: 'Cookie',
	})
	await loginSession.getHeaders(headers)

	return json(
		{
			email: loginSession.getEmail(),
			error: loginSession.getError(),
		},
		{ headers },
	)
}

export const headers: HeadersFunction = reuseUsefulLoaderHeaders

export const meta: MetaFunction<typeof loader, { root: RootLoaderType }> = ({
	matches,
}) => {
	const requestInfo = matches.find((m) => m.id === 'root')?.data.requestInfo
	const domain = new URL(getOrigin(requestInfo)).host
	return getSocialMetas({
		title: `Login to ${domain}`,
		description: `Sign up or login to ${domain} to join a team and learn together.`,
		url: getUrl(requestInfo),
		image: getGenericSocialImage({
			url: getDisplayUrl(requestInfo),
			featuredImage: images.skis.id,
			words: `Login to your account on ${domain}`,
		}),
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const formData = await request.formData()
	const loginSession = await getLoginInfoSession(request)

	const emailAddress = formData.get('email')
	invariant(typeof emailAddress === 'string', 'Form submitted incorrectly')
	if (emailAddress) loginSession.setEmail(emailAddress)

	if (!emailAddress.match(/.+@.+/)) {
		loginSession.flashError('A valid email is required')
		return redirect(`/login`, {
			status: 400,
			headers: await loginSession.getHeaders(),
		})
	}

	// this is our honeypot. Our login is passwordless.
	const failedHoneypot = Boolean(formData.get('password'))
	if (failedHoneypot) {
		console.info(
			`FAILED HONEYPOT ON LOGIN`,
			Object.fromEntries(formData.entries()),
		)
		return redirect(`/login`, {
			headers: await loginSession.getHeaders(),
		})
	}

	try {
		const verifiedStatus = await isEmailVerified(emailAddress)
		if (!verifiedStatus.verified) {
			const errorMessage = `I tried to verify that email and got this error message: "${verifiedStatus.message}". If you think this is wrong, sign up for Kent's mailing list first (using the form on the bottom of the page) and once that's confirmed you'll be able to sign up.`
			loginSession.flashError(errorMessage)
			return redirect(`/login`, {
				status: 400,
				headers: await loginSession.getHeaders(),
			})
		}
	} catch (error: unknown) {
		console.error(`There was an error verifying an email address:`, error)
		// continue on... This was probably our fault...
		// IDEA: notify me of this issue...
	}

	try {
		const domainUrl = getDomainUrl(request)
		const magicLink = await sendToken({ emailAddress, domainUrl })
		loginSession.setMagicLink(magicLink)
		return redirect(`/login`, {
			headers: await loginSession.getHeaders(),
		})
	} catch (e: unknown) {
		loginSession.flashError(getErrorMessage(e))
		return redirect(`/login`, {
			status: 400,
			headers: await loginSession.getHeaders(),
		})
	}
}

async function isEmailVerified(
	email: string,
): Promise<{ verified: true } | { verified: false; message: string }> {
	const verifierResult = await verifyEmailAddress(email)
	if (verifierResult.status) return { verified: true }
	const userExists = Boolean(
		await prisma.user.findUnique({
			select: { id: true },
			where: { email },
		}),
	)
	if (userExists) return { verified: true }
	const convertKitSubscriber = await getConvertKitSubscriber(email)
	if (convertKitSubscriber) return { verified: true }

	return { verified: false, message: verifierResult.error.message }
}

function Login() {
	const data = useLoaderData<typeof loader>()
	const inputRef = React.useRef<HTMLInputElement>(null)

	const [formValues, setFormValues] = React.useState({
		email: data.email ?? '',
	})

	const formIsValid = formValues.email.match(/.+@.+/)

	return (
		<>
			<HeroSection
				imageBuilder={images.skis}
				imageSize="medium"
				title="Log in to your account."
				subtitle="Or sign up for an account."
				action={
					<main>
						<Form
							onChange={(event) => {
								const form = event.currentTarget
								setFormValues({ email: form.email.value })
							}}
							action="/login"
							method="POST"
							className="mb-10 lg:mb-12"
						>
							<div className="mb-6">
								<div className="mb-4 flex flex-wrap items-baseline justify-between">
									<Label htmlFor="email-address">Email address</Label>
								</div>

								<Input
									ref={inputRef}
									autoFocus
									aria-describedby={
										data.error ? 'error-message' : 'success-message'
									}
									id="email-address"
									name="email"
									type="email"
									autoComplete="email"
									defaultValue={formValues.email}
									required
									placeholder="Email address"
								/>
							</div>

							<div style={{ position: 'absolute', left: '-9999px' }}>
								<label htmlFor="password-field">Password</label>
								<input
									type="password"
									id="password-field"
									name="password"
									tabIndex={-1}
									autoComplete="nope"
								/>
							</div>

							<div className="flex flex-wrap gap-4">
								<Button type="submit">Email a login link</Button>
								<LinkButton
									type="reset"
									onClick={() => {
										setFormValues({ email: '' })
										inputRef.current?.focus()
									}}
								>
									Reset
								</LinkButton>
							</div>

							<div className="sr-only" aria-live="polite">
								{formIsValid
									? 'Sign in form is now valid and ready to submit'
									: 'Sign in form is now invalid.'}
							</div>

							<div className="mt-2">
								{data.error ? (
									<InputError id="error-message">{data.error}</InputError>
								) : data.email ? (
									<p
										id="success-message"
										className="text-lg text-gray-500 dark:text-slate-500"
									>
										{`✨ A magic link has been sent to ${data.email}.`}
									</p>
								) : null}
							</div>
						</Form>
					</main>
				}
			/>
			<Grid>
				<Paragraph className="col-span-full mb-10 md:col-span-4">
					{`
              To sign in to your account or to create a new one fill in your
              email above and we'll send you an email with a magic link to get
              you started.
            `}
				</Paragraph>

				<Paragraph
					className="col-span-full mb-10 text-sm md:col-span-4 lg:col-start-7"
					prose={false}
				>
					{`Tip: this account is a completely different account from your `}
					<a
						href="https://testingjavascript.com"
						className="underlined text-yellow-500"
						target="_blank"
						rel="noreferrer noopener"
					>
						TestingJavaScript.com
					</a>
					{`, `}
					<a
						href="https://epicreact.dev"
						className="underlined text-blue-500"
						target="_blank"
						rel="noreferrer noopener"
					>
						EpicReact.dev
					</a>
					{`, and `}
					<a
						href="https://epicweb.dev"
						className="underlined text-red-500"
						target="_blank"
						rel="noreferrer noopener"
					>
						EpicWeb.dev
					</a>
					{`
            accounts, but I recommend you use the same email address for all of
            them because they all feed into my mailing list.
          `}
				</Paragraph>
			</Grid>
		</>
	)
}

export default Login
