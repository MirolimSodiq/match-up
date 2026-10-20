// AUTO-GENERATED: `pnpm db:pull`
import { relations } from "drizzle-orm/relations";
import { currencies, countries, cities, users, mediaAssets, userSessions, deviceTokens, authIdentities, venues, pitches, fieldLeases, sports, matches, cancellationPolicies, competitions, waiverTemplates, waiverSignatures, matchParticipants, bookings, matchSides, matchWaitlist, competitionEntries, paymentProviderConfigs, payments, paymentEvents, refunds, walletAccounts, walletTransactions, consents, dataSubjectRequests, auditLogs, hostProfiles, hostPayouts, hostAssignments, checkinEvents, matchFeedback, highlights, notifications, highlightShares, teams, matchEvents, mediaProcessingJobs, pushDeliveries, venueAmenities, amenities, pitchSports, hostSports, userRoles, highlightTags, highlightReactions, fxRates, teamMembers, playerSportProfiles } from "./schema";

export const countriesRelations = relations(countries, ({one, many}) => ({
	currency: one(currencies, {
		fields: [countries.defaultCurrency],
		references: [currencies.code]
	}),
	cities: many(cities),
	users: many(users),
	waiverTemplates: many(waiverTemplates),
	paymentProviderConfigs: many(paymentProviderConfigs),
}));

export const currenciesRelations = relations(currencies, ({many}) => ({
	countries: many(countries),
	cities: many(cities),
	fieldLeases: many(fieldLeases),
	matches: many(matches),
	bookings: many(bookings),
	payments: many(payments),
	refunds: many(refunds),
	walletAccounts: many(walletAccounts),
	hostPayouts: many(hostPayouts),
	hostAssignments: many(hostAssignments),
	competitions: many(competitions),
	fxRates_baseCurrency: many(fxRates, {
		relationName: "fxRates_baseCurrency_currencies_code"
	}),
	fxRates_quoteCurrency: many(fxRates, {
		relationName: "fxRates_quoteCurrency_currencies_code"
	}),
}));

export const citiesRelations = relations(cities, ({one, many}) => ({
	country: one(countries, {
		fields: [cities.countryCode],
		references: [countries.code]
	}),
	currency: one(currencies, {
		fields: [cities.defaultCurrency],
		references: [currencies.code]
	}),
	users: many(users),
	venues: many(venues),
	matches: many(matches),
	hostProfiles: many(hostProfiles),
	teams: many(teams),
	competitions: many(competitions),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	country: one(countries, {
		fields: [users.countryCode],
		references: [countries.code]
	}),
	city: one(cities, {
		fields: [users.homeCityId],
		references: [cities.id]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [users.avatarMediaId],
		references: [mediaAssets.id],
		relationName: "users_avatarMediaId_mediaAssets_id"
	}),
	userSessions: many(userSessions),
	deviceTokens: many(deviceTokens),
	authIdentities: many(authIdentities),
	fieldLeases: many(fieldLeases),
	matches: many(matches),
	waiverSignatures: many(waiverSignatures),
	matchParticipants_userId: many(matchParticipants, {
		relationName: "matchParticipants_userId_users_id"
	}),
	matchParticipants_checkedInBy: many(matchParticipants, {
		relationName: "matchParticipants_checkedInBy_users_id"
	}),
	matchWaitlists: many(matchWaitlist),
	bookings_userId: many(bookings, {
		relationName: "bookings_userId_users_id"
	}),
	bookings_cancelledBy: many(bookings, {
		relationName: "bookings_cancelledBy_users_id"
	}),
	payments: many(payments),
	refunds_initiatedBy: many(refunds, {
		relationName: "refunds_initiatedBy_users_id"
	}),
	refunds_processedBy: many(refunds, {
		relationName: "refunds_processedBy_users_id"
	}),
	walletAccounts: many(walletAccounts),
	consents: many(consents),
	dataSubjectRequests_userId: many(dataSubjectRequests, {
		relationName: "dataSubjectRequests_userId_users_id"
	}),
	dataSubjectRequests_handledBy: many(dataSubjectRequests, {
		relationName: "dataSubjectRequests_handledBy_users_id"
	}),
	auditLogs: many(auditLogs),
	hostProfiles_userId: many(hostProfiles, {
		relationName: "hostProfiles_userId_users_id"
	}),
	hostProfiles_verifiedBy: many(hostProfiles, {
		relationName: "hostProfiles_verifiedBy_users_id"
	}),
	checkinEvents: many(checkinEvents),
	matchFeedbacks_fromUserId: many(matchFeedback, {
		relationName: "matchFeedback_fromUserId_users_id"
	}),
	matchFeedbacks_toUserId: many(matchFeedback, {
		relationName: "matchFeedback_toUserId_users_id"
	}),
	mediaAssets: many(mediaAssets, {
		relationName: "mediaAssets_ownerUserId_users_id"
	}),
	highlights: many(highlights),
	notifications: many(notifications),
	highlightShares: many(highlightShares),
	teams: many(teams),
	competitions: many(competitions),
	competitionEntries: many(competitionEntries),
	matchEvents: many(matchEvents),
	userRoles_userId: many(userRoles, {
		relationName: "userRoles_userId_users_id"
	}),
	userRoles_grantedBy: many(userRoles, {
		relationName: "userRoles_grantedBy_users_id"
	}),
	highlightTags_userId: many(highlightTags, {
		relationName: "highlightTags_userId_users_id"
	}),
	highlightTags_taggedBy: many(highlightTags, {
		relationName: "highlightTags_taggedBy_users_id"
	}),
	highlightReactions: many(highlightReactions),
	teamMembers: many(teamMembers),
	playerSportProfiles: many(playerSportProfiles),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({one, many}) => ({
	users: many(users, {
		relationName: "users_avatarMediaId_mediaAssets_id"
	}),
	venues: many(venues),
	dataSubjectRequests: many(dataSubjectRequests),
	user: one(users, {
		fields: [mediaAssets.ownerUserId],
		references: [users.id],
		relationName: "mediaAssets_ownerUserId_users_id"
	}),
	highlights: many(highlights),
	teams: many(teams),
	mediaProcessingJobs: many(mediaProcessingJobs),
}));

export const userSessionsRelations = relations(userSessions, ({one}) => ({
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id]
	}),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one, many}) => ({
	user: one(users, {
		fields: [deviceTokens.userId],
		references: [users.id]
	}),
	pushDeliveries: many(pushDeliveries),
}));

export const authIdentitiesRelations = relations(authIdentities, ({one}) => ({
	user: one(users, {
		fields: [authIdentities.userId],
		references: [users.id]
	}),
}));

export const venuesRelations = relations(venues, ({one, many}) => ({
	city: one(cities, {
		fields: [venues.cityId],
		references: [cities.id]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [venues.coverMediaId],
		references: [mediaAssets.id]
	}),
	pitches: many(pitches),
	venueAmenities: many(venueAmenities),
}));

export const pitchesRelations = relations(pitches, ({one, many}) => ({
	venue: one(venues, {
		fields: [pitches.venueId],
		references: [venues.id]
	}),
	fieldLeases: many(fieldLeases),
	matches: many(matches),
	pitchSports: many(pitchSports),
}));

export const fieldLeasesRelations = relations(fieldLeases, ({one, many}) => ({
	pitch: one(pitches, {
		fields: [fieldLeases.pitchId],
		references: [pitches.id]
	}),
	currency: one(currencies, {
		fields: [fieldLeases.currency],
		references: [currencies.code]
	}),
	user: one(users, {
		fields: [fieldLeases.createdBy],
		references: [users.id]
	}),
	matches: many(matches),
}));

export const matchesRelations = relations(matches, ({one, many}) => ({
	sport: one(sports, {
		fields: [matches.sportId],
		references: [sports.id]
	}),
	pitch: one(pitches, {
		fields: [matches.pitchId],
		references: [pitches.id]
	}),
	fieldLease: one(fieldLeases, {
		fields: [matches.leaseId],
		references: [fieldLeases.id]
	}),
	city: one(cities, {
		fields: [matches.cityId],
		references: [cities.id]
	}),
	currency: one(currencies, {
		fields: [matches.currency],
		references: [currencies.code]
	}),
	cancellationPolicy: one(cancellationPolicies, {
		fields: [matches.cancellationPolicyId],
		references: [cancellationPolicies.id]
	}),
	user: one(users, {
		fields: [matches.createdBy],
		references: [users.id]
	}),
	competition: one(competitions, {
		fields: [matches.competitionId],
		references: [competitions.id]
	}),
	waiverSignatures: many(waiverSignatures),
	matchParticipants: many(matchParticipants),
	matchWaitlists: many(matchWaitlist),
	bookings: many(bookings),
	hostAssignments: many(hostAssignments),
	checkinEvents: many(checkinEvents),
	matchFeedbacks: many(matchFeedback),
	highlights: many(highlights),
	matchEvents: many(matchEvents),
	matchSides: many(matchSides),
}));

export const sportsRelations = relations(sports, ({many}) => ({
	matches: many(matches),
	waiverTemplates: many(waiverTemplates),
	teams: many(teams),
	competitions: many(competitions),
	pitchSports: many(pitchSports),
	hostSports: many(hostSports),
	playerSportProfiles: many(playerSportProfiles),
}));

export const cancellationPoliciesRelations = relations(cancellationPolicies, ({many}) => ({
	matches: many(matches),
	competitions: many(competitions),
}));

export const competitionsRelations = relations(competitions, ({one, many}) => ({
	matches: many(matches),
	sport: one(sports, {
		fields: [competitions.sportId],
		references: [sports.id]
	}),
	city: one(cities, {
		fields: [competitions.cityId],
		references: [cities.id]
	}),
	currency: one(currencies, {
		fields: [competitions.currency],
		references: [currencies.code]
	}),
	cancellationPolicy: one(cancellationPolicies, {
		fields: [competitions.cancellationPolicyId],
		references: [cancellationPolicies.id]
	}),
	user: one(users, {
		fields: [competitions.createdBy],
		references: [users.id]
	}),
	competitionEntries: many(competitionEntries),
}));

export const waiverTemplatesRelations = relations(waiverTemplates, ({one, many}) => ({
	country: one(countries, {
		fields: [waiverTemplates.countryCode],
		references: [countries.code]
	}),
	sport: one(sports, {
		fields: [waiverTemplates.sportId],
		references: [sports.id]
	}),
	waiverSignatures: many(waiverSignatures),
}));

export const waiverSignaturesRelations = relations(waiverSignatures, ({one, many}) => ({
	user: one(users, {
		fields: [waiverSignatures.userId],
		references: [users.id]
	}),
	waiverTemplate: one(waiverTemplates, {
		fields: [waiverSignatures.templateId],
		references: [waiverTemplates.id]
	}),
	match: one(matches, {
		fields: [waiverSignatures.matchId],
		references: [matches.id]
	}),
	bookings: many(bookings),
}));

export const matchParticipantsRelations = relations(matchParticipants, ({one, many}) => ({
	match: one(matches, {
		fields: [matchParticipants.matchId],
		references: [matches.id]
	}),
	booking: one(bookings, {
		fields: [matchParticipants.bookingId],
		references: [bookings.id]
	}),
	user_userId: one(users, {
		fields: [matchParticipants.userId],
		references: [users.id],
		relationName: "matchParticipants_userId_users_id"
	}),
	user_checkedInBy: one(users, {
		fields: [matchParticipants.checkedInBy],
		references: [users.id],
		relationName: "matchParticipants_checkedInBy_users_id"
	}),
	matchSide: one(matchSides, {
		fields: [matchParticipants.matchId],
		references: [matchSides.matchId]
	}),
	checkinEvents: many(checkinEvents),
	matchEvents: many(matchEvents),
}));

export const bookingsRelations = relations(bookings, ({one, many}) => ({
	matchParticipants: many(matchParticipants),
	user_userId: one(users, {
		fields: [bookings.userId],
		references: [users.id],
		relationName: "bookings_userId_users_id"
	}),
	match: one(matches, {
		fields: [bookings.matchId],
		references: [matches.id]
	}),
	currency: one(currencies, {
		fields: [bookings.currency],
		references: [currencies.code]
	}),
	waiverSignature: one(waiverSignatures, {
		fields: [bookings.waiverSignatureId],
		references: [waiverSignatures.id]
	}),
	user_cancelledBy: one(users, {
		fields: [bookings.cancelledBy],
		references: [users.id],
		relationName: "bookings_cancelledBy_users_id"
	}),
	competitionEntry: one(competitionEntries, {
		fields: [bookings.competitionEntryId],
		references: [competitionEntries.id]
	}),
	payments: many(payments),
	refunds: many(refunds),
	walletTransactions: many(walletTransactions),
}));

export const matchSidesRelations = relations(matchSides, ({one, many}) => ({
	matchParticipants: many(matchParticipants),
	matchEvents: many(matchEvents),
	match: one(matches, {
		fields: [matchSides.matchId],
		references: [matches.id]
	}),
	team: one(teams, {
		fields: [matchSides.teamId],
		references: [teams.id]
	}),
}));

export const matchWaitlistRelations = relations(matchWaitlist, ({one}) => ({
	match: one(matches, {
		fields: [matchWaitlist.matchId],
		references: [matches.id]
	}),
	user: one(users, {
		fields: [matchWaitlist.userId],
		references: [users.id]
	}),
}));

export const competitionEntriesRelations = relations(competitionEntries, ({one, many}) => ({
	bookings: many(bookings),
	competition: one(competitions, {
		fields: [competitionEntries.competitionId],
		references: [competitions.id]
	}),
	team: one(teams, {
		fields: [competitionEntries.teamId],
		references: [teams.id]
	}),
	user: one(users, {
		fields: [competitionEntries.registeredBy],
		references: [users.id]
	}),
}));

export const paymentProviderConfigsRelations = relations(paymentProviderConfigs, ({one}) => ({
	country: one(countries, {
		fields: [paymentProviderConfigs.countryCode],
		references: [countries.code]
	}),
}));

export const paymentsRelations = relations(payments, ({one, many}) => ({
	booking: one(bookings, {
		fields: [payments.bookingId],
		references: [bookings.id]
	}),
	user: one(users, {
		fields: [payments.userId],
		references: [users.id]
	}),
	currency: one(currencies, {
		fields: [payments.currency],
		references: [currencies.code]
	}),
	paymentEvents: many(paymentEvents),
	refunds: many(refunds),
}));

export const paymentEventsRelations = relations(paymentEvents, ({one}) => ({
	payment: one(payments, {
		fields: [paymentEvents.paymentId],
		references: [payments.id]
	}),
}));

export const refundsRelations = relations(refunds, ({one, many}) => ({
	payment: one(payments, {
		fields: [refunds.paymentId],
		references: [payments.id]
	}),
	booking: one(bookings, {
		fields: [refunds.bookingId],
		references: [bookings.id]
	}),
	currency: one(currencies, {
		fields: [refunds.currency],
		references: [currencies.code]
	}),
	user_initiatedBy: one(users, {
		fields: [refunds.initiatedBy],
		references: [users.id],
		relationName: "refunds_initiatedBy_users_id"
	}),
	user_processedBy: one(users, {
		fields: [refunds.processedBy],
		references: [users.id],
		relationName: "refunds_processedBy_users_id"
	}),
	walletTransactions: many(walletTransactions),
}));

export const walletAccountsRelations = relations(walletAccounts, ({one, many}) => ({
	user: one(users, {
		fields: [walletAccounts.userId],
		references: [users.id]
	}),
	currency: one(currencies, {
		fields: [walletAccounts.currency],
		references: [currencies.code]
	}),
	walletTransactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	walletAccount: one(walletAccounts, {
		fields: [walletTransactions.walletId],
		references: [walletAccounts.id]
	}),
	booking: one(bookings, {
		fields: [walletTransactions.bookingId],
		references: [bookings.id]
	}),
	refund: one(refunds, {
		fields: [walletTransactions.refundId],
		references: [refunds.id]
	}),
}));

export const consentsRelations = relations(consents, ({one}) => ({
	user: one(users, {
		fields: [consents.userId],
		references: [users.id]
	}),
}));

export const dataSubjectRequestsRelations = relations(dataSubjectRequests, ({one}) => ({
	user_userId: one(users, {
		fields: [dataSubjectRequests.userId],
		references: [users.id],
		relationName: "dataSubjectRequests_userId_users_id"
	}),
	user_handledBy: one(users, {
		fields: [dataSubjectRequests.handledBy],
		references: [users.id],
		relationName: "dataSubjectRequests_handledBy_users_id"
	}),
	mediaAsset: one(mediaAssets, {
		fields: [dataSubjectRequests.exportMediaId],
		references: [mediaAssets.id]
	}),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.actorUserId],
		references: [users.id]
	}),
}));

export const hostProfilesRelations = relations(hostProfiles, ({one, many}) => ({
	user_userId: one(users, {
		fields: [hostProfiles.userId],
		references: [users.id],
		relationName: "hostProfiles_userId_users_id"
	}),
	city: one(cities, {
		fields: [hostProfiles.homeCityId],
		references: [cities.id]
	}),
	user_verifiedBy: one(users, {
		fields: [hostProfiles.verifiedBy],
		references: [users.id],
		relationName: "hostProfiles_verifiedBy_users_id"
	}),
	hostPayouts: many(hostPayouts),
	hostAssignments: many(hostAssignments),
	hostSports: many(hostSports),
}));

export const hostPayoutsRelations = relations(hostPayouts, ({one, many}) => ({
	hostProfile: one(hostProfiles, {
		fields: [hostPayouts.hostUserId],
		references: [hostProfiles.userId]
	}),
	currency: one(currencies, {
		fields: [hostPayouts.currency],
		references: [currencies.code]
	}),
	hostAssignments: many(hostAssignments),
}));

export const hostAssignmentsRelations = relations(hostAssignments, ({one, many}) => ({
	match: one(matches, {
		fields: [hostAssignments.matchId],
		references: [matches.id]
	}),
	hostProfile: one(hostProfiles, {
		fields: [hostAssignments.hostUserId],
		references: [hostProfiles.userId]
	}),
	currency: one(currencies, {
		fields: [hostAssignments.currency],
		references: [currencies.code]
	}),
	hostPayout: one(hostPayouts, {
		fields: [hostAssignments.payoutId],
		references: [hostPayouts.id]
	}),
	checkinEvents: many(checkinEvents),
}));

export const checkinEventsRelations = relations(checkinEvents, ({one}) => ({
	match: one(matches, {
		fields: [checkinEvents.matchId],
		references: [matches.id]
	}),
	matchParticipant: one(matchParticipants, {
		fields: [checkinEvents.participantId],
		references: [matchParticipants.id]
	}),
	hostAssignment: one(hostAssignments, {
		fields: [checkinEvents.hostAssignmentId],
		references: [hostAssignments.id]
	}),
	user: one(users, {
		fields: [checkinEvents.actorUserId],
		references: [users.id]
	}),
}));

export const matchFeedbackRelations = relations(matchFeedback, ({one}) => ({
	match: one(matches, {
		fields: [matchFeedback.matchId],
		references: [matches.id]
	}),
	user_fromUserId: one(users, {
		fields: [matchFeedback.fromUserId],
		references: [users.id],
		relationName: "matchFeedback_fromUserId_users_id"
	}),
	user_toUserId: one(users, {
		fields: [matchFeedback.toUserId],
		references: [users.id],
		relationName: "matchFeedback_toUserId_users_id"
	}),
}));

export const highlightsRelations = relations(highlights, ({one, many}) => ({
	match: one(matches, {
		fields: [highlights.matchId],
		references: [matches.id]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [highlights.mediaAssetId],
		references: [mediaAssets.id]
	}),
	user: one(users, {
		fields: [highlights.createdBy],
		references: [users.id]
	}),
	highlightShares: many(highlightShares),
	matchEvents: many(matchEvents),
	highlightTags: many(highlightTags),
	highlightReactions: many(highlightReactions),
}));

export const notificationsRelations = relations(notifications, ({one, many}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
	pushDeliveries: many(pushDeliveries),
}));

export const highlightSharesRelations = relations(highlightShares, ({one}) => ({
	highlight: one(highlights, {
		fields: [highlightShares.highlightId],
		references: [highlights.id]
	}),
	user: one(users, {
		fields: [highlightShares.userId],
		references: [users.id]
	}),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	sport: one(sports, {
		fields: [teams.sportId],
		references: [sports.id]
	}),
	city: one(cities, {
		fields: [teams.cityId],
		references: [cities.id]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [teams.logoMediaId],
		references: [mediaAssets.id]
	}),
	user: one(users, {
		fields: [teams.captainUserId],
		references: [users.id]
	}),
	competitionEntries: many(competitionEntries),
	matchSides: many(matchSides),
	teamMembers: many(teamMembers),
}));

export const matchEventsRelations = relations(matchEvents, ({one}) => ({
	match: one(matches, {
		fields: [matchEvents.matchId],
		references: [matches.id]
	}),
	matchParticipant: one(matchParticipants, {
		fields: [matchEvents.participantId],
		references: [matchParticipants.id]
	}),
	highlight: one(highlights, {
		fields: [matchEvents.highlightId],
		references: [highlights.id]
	}),
	user: one(users, {
		fields: [matchEvents.recordedBy],
		references: [users.id]
	}),
	matchSide: one(matchSides, {
		fields: [matchEvents.matchId],
		references: [matchSides.matchId]
	}),
}));

export const mediaProcessingJobsRelations = relations(mediaProcessingJobs, ({one}) => ({
	mediaAsset: one(mediaAssets, {
		fields: [mediaProcessingJobs.mediaAssetId],
		references: [mediaAssets.id]
	}),
}));

export const pushDeliveriesRelations = relations(pushDeliveries, ({one}) => ({
	notification: one(notifications, {
		fields: [pushDeliveries.notificationId],
		references: [notifications.id]
	}),
	deviceToken: one(deviceTokens, {
		fields: [pushDeliveries.deviceTokenId],
		references: [deviceTokens.id]
	}),
}));

export const venueAmenitiesRelations = relations(venueAmenities, ({one}) => ({
	venue: one(venues, {
		fields: [venueAmenities.venueId],
		references: [venues.id]
	}),
	amenity: one(amenities, {
		fields: [venueAmenities.amenityId],
		references: [amenities.id]
	}),
}));

export const amenitiesRelations = relations(amenities, ({many}) => ({
	venueAmenities: many(venueAmenities),
}));

export const pitchSportsRelations = relations(pitchSports, ({one}) => ({
	pitch: one(pitches, {
		fields: [pitchSports.pitchId],
		references: [pitches.id]
	}),
	sport: one(sports, {
		fields: [pitchSports.sportId],
		references: [sports.id]
	}),
}));

export const hostSportsRelations = relations(hostSports, ({one}) => ({
	hostProfile: one(hostProfiles, {
		fields: [hostSports.userId],
		references: [hostProfiles.userId]
	}),
	sport: one(sports, {
		fields: [hostSports.sportId],
		references: [sports.id]
	}),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user_userId: one(users, {
		fields: [userRoles.userId],
		references: [users.id],
		relationName: "userRoles_userId_users_id"
	}),
	user_grantedBy: one(users, {
		fields: [userRoles.grantedBy],
		references: [users.id],
		relationName: "userRoles_grantedBy_users_id"
	}),
}));

export const highlightTagsRelations = relations(highlightTags, ({one}) => ({
	highlight: one(highlights, {
		fields: [highlightTags.highlightId],
		references: [highlights.id]
	}),
	user_userId: one(users, {
		fields: [highlightTags.userId],
		references: [users.id],
		relationName: "highlightTags_userId_users_id"
	}),
	user_taggedBy: one(users, {
		fields: [highlightTags.taggedBy],
		references: [users.id],
		relationName: "highlightTags_taggedBy_users_id"
	}),
}));

export const highlightReactionsRelations = relations(highlightReactions, ({one}) => ({
	highlight: one(highlights, {
		fields: [highlightReactions.highlightId],
		references: [highlights.id]
	}),
	user: one(users, {
		fields: [highlightReactions.userId],
		references: [users.id]
	}),
}));

export const fxRatesRelations = relations(fxRates, ({one}) => ({
	currency_baseCurrency: one(currencies, {
		fields: [fxRates.baseCurrency],
		references: [currencies.code],
		relationName: "fxRates_baseCurrency_currencies_code"
	}),
	currency_quoteCurrency: one(currencies, {
		fields: [fxRates.quoteCurrency],
		references: [currencies.code],
		relationName: "fxRates_quoteCurrency_currencies_code"
	}),
}));

export const teamMembersRelations = relations(teamMembers, ({one}) => ({
	team: one(teams, {
		fields: [teamMembers.teamId],
		references: [teams.id]
	}),
	user: one(users, {
		fields: [teamMembers.userId],
		references: [users.id]
	}),
}));

export const playerSportProfilesRelations = relations(playerSportProfiles, ({one}) => ({
	user: one(users, {
		fields: [playerSportProfiles.userId],
		references: [users.id]
	}),
	sport: one(sports, {
		fields: [playerSportProfiles.sportId],
		references: [sports.id]
	}),
}));