// AUTO-GENERATED: `pnpm db:pull`
import { relations } from "drizzle-orm/relations";
import {
	amenities,
	auditLogs,
	authIdentities,
	bookings,
	cancellationPolicies,
	checkinEvents,
	cities,
	competitionEntries,
	competitions,
	consents,
	countries,
	currencies,
	dataSubjectRequests,
	deviceTokens,
	fieldLeases,
	fxRates,
	highlightReactions,
	highlightShares,
	highlightTags,
	highlights,
	hostAssignments,
	hostPayouts,
	hostProfiles,
	hostSports,
	matchEvents,
	matchFeedback,
	matchParticipants,
	matchSides,
	matchWaitlist,
	matches,
	mediaAssets,
	mediaProcessingJobs,
	notifications,
	paymentEvents,
	paymentProviderConfigs,
	payments,
	pitchSports,
	pitches,
	playerRatingChanges,
	playerSportProfiles,
	pushDeliveries,
	reconciliationItems,
	reconciliationRuns,
	recordingCameras,
	recordingMarkers,
	recordingSessions,
	refunds,
	sports,
	teamMembers,
	teams,
	userRoles,
	userSessions,
	users,
	venueAmenities,
	venues,
	waiverSignatures,
	waiverTemplates,
	walletAccounts,
	walletTransactions,
} from "./schema";

export const amenitiesRelations = relations(amenities, ({many}) => ({
	venueAmenities: many(venueAmenities),
}));

export const auditLogsRelations = relations(auditLogs, ({one}) => ({
	user: one(users, {
		fields: [auditLogs.actorUserId],
		references: [users.id]
	}),
}));

export const authIdentitiesRelations = relations(authIdentities, ({one}) => ({
	user: one(users, {
		fields: [authIdentities.userId],
		references: [users.id]
	}),
}));

export const bookingsRelations = relations(bookings, ({one, many}) => ({
	competitionEntry: one(competitionEntries, {
		fields: [bookings.competitionEntryId],
		references: [competitionEntries.id]
	}),
	currency: one(currencies, {
		fields: [bookings.currency],
		references: [currencies.code]
	}),
	match: one(matches, {
		fields: [bookings.matchId],
		references: [matches.id]
	}),
	user_cancelledBy: one(users, {
		fields: [bookings.cancelledBy],
		references: [users.id],
		relationName: "bookings_cancelledBy_users_id"
	}),
	user_userId: one(users, {
		fields: [bookings.userId],
		references: [users.id],
		relationName: "bookings_userId_users_id"
	}),
	waiverSignature: one(waiverSignatures, {
		fields: [bookings.waiverSignatureId],
		references: [waiverSignatures.id]
	}),
	matchParticipants: many(matchParticipants),
	payments: many(payments),
	refunds: many(refunds),
	walletTransactions: many(walletTransactions),
}));

export const cancellationPoliciesRelations = relations(cancellationPolicies, ({many}) => ({
	competitions: many(competitions),
	matches: many(matches),
}));

export const checkinEventsRelations = relations(checkinEvents, ({one}) => ({
	hostAssignment: one(hostAssignments, {
		fields: [checkinEvents.hostAssignmentId],
		references: [hostAssignments.id]
	}),
	match: one(matches, {
		fields: [checkinEvents.matchId],
		references: [matches.id]
	}),
	matchParticipant: one(matchParticipants, {
		fields: [checkinEvents.participantId],
		references: [matchParticipants.id]
	}),
	user: one(users, {
		fields: [checkinEvents.actorUserId],
		references: [users.id]
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
	competitions: many(competitions),
	hostProfiles: many(hostProfiles),
	matches: many(matches),
	teams: many(teams),
	users: many(users),
	venues: many(venues),
}));

export const competitionEntriesRelations = relations(competitionEntries, ({one, many}) => ({
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
	bookings: many(bookings),
}));

export const competitionsRelations = relations(competitions, ({one, many}) => ({
	cancellationPolicy: one(cancellationPolicies, {
		fields: [competitions.cancellationPolicyId],
		references: [cancellationPolicies.id]
	}),
	city: one(cities, {
		fields: [competitions.cityId],
		references: [cities.id]
	}),
	currency: one(currencies, {
		fields: [competitions.currency],
		references: [currencies.code]
	}),
	sport: one(sports, {
		fields: [competitions.sportId],
		references: [sports.id]
	}),
	user: one(users, {
		fields: [competitions.createdBy],
		references: [users.id]
	}),
	competitionEntries: many(competitionEntries),
	matches: many(matches),
}));

export const consentsRelations = relations(consents, ({one}) => ({
	user: one(users, {
		fields: [consents.userId],
		references: [users.id]
	}),
}));

export const countriesRelations = relations(countries, ({one, many}) => ({
	currency: one(currencies, {
		fields: [countries.defaultCurrency],
		references: [currencies.code]
	}),
	cities: many(cities),
	paymentProviderConfigs: many(paymentProviderConfigs),
	users: many(users),
	waiverTemplates: many(waiverTemplates),
}));

export const currenciesRelations = relations(currencies, ({many}) => ({
	bookings: many(bookings),
	cities: many(cities),
	competitions: many(competitions),
	countries: many(countries),
	fieldLeases: many(fieldLeases),
	fxRates_baseCurrency: many(fxRates, {
		relationName: "fxRates_baseCurrency_currencies_code"
	}),
	fxRates_quoteCurrency: many(fxRates, {
		relationName: "fxRates_quoteCurrency_currencies_code"
	}),
	hostAssignments: many(hostAssignments),
	hostPayouts: many(hostPayouts),
	matches: many(matches),
	payments: many(payments),
	reconciliationItems: many(reconciliationItems),
	refunds: many(refunds),
	walletAccounts: many(walletAccounts),
}));

export const dataSubjectRequestsRelations = relations(dataSubjectRequests, ({one}) => ({
	mediaAsset: one(mediaAssets, {
		fields: [dataSubjectRequests.exportMediaId],
		references: [mediaAssets.id]
	}),
	user_handledBy: one(users, {
		fields: [dataSubjectRequests.handledBy],
		references: [users.id],
		relationName: "dataSubjectRequests_handledBy_users_id"
	}),
	user_userId: one(users, {
		fields: [dataSubjectRequests.userId],
		references: [users.id],
		relationName: "dataSubjectRequests_userId_users_id"
	}),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one, many}) => ({
	user: one(users, {
		fields: [deviceTokens.userId],
		references: [users.id]
	}),
	pushDeliveries: many(pushDeliveries),
}));

export const fieldLeasesRelations = relations(fieldLeases, ({one, many}) => ({
	currency: one(currencies, {
		fields: [fieldLeases.currency],
		references: [currencies.code]
	}),
	pitch: one(pitches, {
		fields: [fieldLeases.pitchId],
		references: [pitches.id]
	}),
	user: one(users, {
		fields: [fieldLeases.createdBy],
		references: [users.id]
	}),
	matches: many(matches),
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

export const highlightTagsRelations = relations(highlightTags, ({one}) => ({
	highlight: one(highlights, {
		fields: [highlightTags.highlightId],
		references: [highlights.id]
	}),
	user_taggedBy: one(users, {
		fields: [highlightTags.taggedBy],
		references: [users.id],
		relationName: "highlightTags_taggedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [highlightTags.userId],
		references: [users.id],
		relationName: "highlightTags_userId_users_id"
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
	recordingSession: one(recordingSessions, {
		fields: [highlights.recordingSessionId],
		references: [recordingSessions.id]
	}),
	user: one(users, {
		fields: [highlights.createdBy],
		references: [users.id]
	}),
	highlightReactions: many(highlightReactions),
	highlightShares: many(highlightShares),
	highlightTags: many(highlightTags),
	matchEvents: many(matchEvents),
	recordingMarkers: many(recordingMarkers),
}));

export const hostAssignmentsRelations = relations(hostAssignments, ({one, many}) => ({
	currency: one(currencies, {
		fields: [hostAssignments.currency],
		references: [currencies.code]
	}),
	hostPayout: one(hostPayouts, {
		fields: [hostAssignments.payoutId],
		references: [hostPayouts.id]
	}),
	hostProfile: one(hostProfiles, {
		fields: [hostAssignments.hostUserId],
		references: [hostProfiles.userId]
	}),
	match: one(matches, {
		fields: [hostAssignments.matchId],
		references: [matches.id]
	}),
	checkinEvents: many(checkinEvents),
}));

export const hostPayoutsRelations = relations(hostPayouts, ({one, many}) => ({
	currency: one(currencies, {
		fields: [hostPayouts.currency],
		references: [currencies.code]
	}),
	hostProfile: one(hostProfiles, {
		fields: [hostPayouts.hostUserId],
		references: [hostProfiles.userId]
	}),
	hostAssignments: many(hostAssignments),
}));

export const hostProfilesRelations = relations(hostProfiles, ({one, many}) => ({
	city: one(cities, {
		fields: [hostProfiles.homeCityId],
		references: [cities.id]
	}),
	user_userId: one(users, {
		fields: [hostProfiles.userId],
		references: [users.id],
		relationName: "hostProfiles_userId_users_id"
	}),
	user_verifiedBy: one(users, {
		fields: [hostProfiles.verifiedBy],
		references: [users.id],
		relationName: "hostProfiles_verifiedBy_users_id"
	}),
	hostAssignments: many(hostAssignments),
	hostPayouts: many(hostPayouts),
	hostSports: many(hostSports),
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

export const matchEventsRelations = relations(matchEvents, ({one}) => ({
	highlight: one(highlights, {
		fields: [matchEvents.highlightId],
		references: [highlights.id]
	}),
	match: one(matches, {
		fields: [matchEvents.matchId],
		references: [matches.id]
	}),
	matchParticipant: one(matchParticipants, {
		fields: [matchEvents.participantId],
		references: [matchParticipants.id]
	}),
	matchSide: one(matchSides, {
		fields: [matchEvents.matchId],
		references: [matchSides.matchId]
	}),
	user: one(users, {
		fields: [matchEvents.recordedBy],
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

export const matchParticipantsRelations = relations(matchParticipants, ({one, many}) => ({
	booking: one(bookings, {
		fields: [matchParticipants.bookingId],
		references: [bookings.id]
	}),
	match: one(matches, {
		fields: [matchParticipants.matchId],
		references: [matches.id]
	}),
	matchSide: one(matchSides, {
		fields: [matchParticipants.matchId],
		references: [matchSides.matchId]
	}),
	user_checkedInBy: one(users, {
		fields: [matchParticipants.checkedInBy],
		references: [users.id],
		relationName: "matchParticipants_checkedInBy_users_id"
	}),
	user_userId: one(users, {
		fields: [matchParticipants.userId],
		references: [users.id],
		relationName: "matchParticipants_userId_users_id"
	}),
	checkinEvents: many(checkinEvents),
	matchEvents: many(matchEvents),
	recordingMarkers: many(recordingMarkers),
}));

export const matchSidesRelations = relations(matchSides, ({one, many}) => ({
	match: one(matches, {
		fields: [matchSides.matchId],
		references: [matches.id]
	}),
	team: one(teams, {
		fields: [matchSides.teamId],
		references: [teams.id]
	}),
	matchEvents: many(matchEvents),
	matchParticipants: many(matchParticipants),
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

export const matchesRelations = relations(matches, ({one, many}) => ({
	cancellationPolicy: one(cancellationPolicies, {
		fields: [matches.cancellationPolicyId],
		references: [cancellationPolicies.id]
	}),
	city: one(cities, {
		fields: [matches.cityId],
		references: [cities.id]
	}),
	competition: one(competitions, {
		fields: [matches.competitionId],
		references: [competitions.id]
	}),
	currency: one(currencies, {
		fields: [matches.currency],
		references: [currencies.code]
	}),
	fieldLease: one(fieldLeases, {
		fields: [matches.leaseId],
		references: [fieldLeases.id]
	}),
	pitch: one(pitches, {
		fields: [matches.pitchId],
		references: [pitches.id]
	}),
	sport: one(sports, {
		fields: [matches.sportId],
		references: [sports.id]
	}),
	user: one(users, {
		fields: [matches.createdBy],
		references: [users.id]
	}),
	bookings: many(bookings),
	checkinEvents: many(checkinEvents),
	highlights: many(highlights),
	hostAssignments: many(hostAssignments),
	matchEvents: many(matchEvents),
	matchFeedbacks: many(matchFeedback),
	matchParticipants: many(matchParticipants),
	matchSides: many(matchSides),
	matchWaitlists: many(matchWaitlist),
	playerRatingChanges: many(playerRatingChanges),
	recordingSessions: many(recordingSessions),
	waiverSignatures: many(waiverSignatures),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({one, many}) => ({
	user: one(users, {
		fields: [mediaAssets.ownerUserId],
		references: [users.id],
		relationName: "mediaAssets_ownerUserId_users_id"
	}),
	dataSubjectRequests: many(dataSubjectRequests),
	highlights: many(highlights),
	mediaProcessingJobs: many(mediaProcessingJobs),
	recordingCameras: many(recordingCameras),
	teams: many(teams),
	users: many(users, {
		relationName: "users_avatarMediaId_mediaAssets_id"
	}),
	venues: many(venues),
}));

export const mediaProcessingJobsRelations = relations(mediaProcessingJobs, ({one}) => ({
	mediaAsset: one(mediaAssets, {
		fields: [mediaProcessingJobs.mediaAssetId],
		references: [mediaAssets.id]
	}),
	recordingSession: one(recordingSessions, {
		fields: [mediaProcessingJobs.recordingSessionId],
		references: [recordingSessions.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one, many}) => ({
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
	pushDeliveries: many(pushDeliveries),
}));

export const paymentEventsRelations = relations(paymentEvents, ({one}) => ({
	payment: one(payments, {
		fields: [paymentEvents.paymentId],
		references: [payments.id]
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
	currency: one(currencies, {
		fields: [payments.currency],
		references: [currencies.code]
	}),
	user: one(users, {
		fields: [payments.userId],
		references: [users.id]
	}),
	paymentEvents: many(paymentEvents),
	reconciliationItems: many(reconciliationItems),
	refunds: many(refunds),
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

export const pitchesRelations = relations(pitches, ({one, many}) => ({
	venue: one(venues, {
		fields: [pitches.venueId],
		references: [venues.id]
	}),
	fieldLeases: many(fieldLeases),
	matches: many(matches),
	pitchSports: many(pitchSports),
}));

export const playerRatingChangesRelations = relations(playerRatingChanges, ({one}) => ({
	match: one(matches, {
		fields: [playerRatingChanges.matchId],
		references: [matches.id]
	}),
	sport: one(sports, {
		fields: [playerRatingChanges.sportId],
		references: [sports.id]
	}),
	user: one(users, {
		fields: [playerRatingChanges.userId],
		references: [users.id]
	}),
}));

export const playerSportProfilesRelations = relations(playerSportProfiles, ({one}) => ({
	sport: one(sports, {
		fields: [playerSportProfiles.sportId],
		references: [sports.id]
	}),
	user: one(users, {
		fields: [playerSportProfiles.userId],
		references: [users.id]
	}),
}));

export const pushDeliveriesRelations = relations(pushDeliveries, ({one}) => ({
	deviceToken: one(deviceTokens, {
		fields: [pushDeliveries.deviceTokenId],
		references: [deviceTokens.id]
	}),
	notification: one(notifications, {
		fields: [pushDeliveries.notificationId],
		references: [notifications.id]
	}),
}));

export const reconciliationItemsRelations = relations(reconciliationItems, ({one}) => ({
	currency: one(currencies, {
		fields: [reconciliationItems.currency],
		references: [currencies.code]
	}),
	payment: one(payments, {
		fields: [reconciliationItems.paymentId],
		references: [payments.id]
	}),
	reconciliationRun: one(reconciliationRuns, {
		fields: [reconciliationItems.runId],
		references: [reconciliationRuns.id]
	}),
}));

export const reconciliationRunsRelations = relations(reconciliationRuns, ({one, many}) => ({
	user: one(users, {
		fields: [reconciliationRuns.triggeredBy],
		references: [users.id]
	}),
	reconciliationItems: many(reconciliationItems),
}));

export const recordingCamerasRelations = relations(recordingCameras, ({one, many}) => ({
	mediaAsset: one(mediaAssets, {
		fields: [recordingCameras.mediaAssetId],
		references: [mediaAssets.id]
	}),
	recordingSession: one(recordingSessions, {
		fields: [recordingCameras.sessionId],
		references: [recordingSessions.id]
	}),
	user: one(users, {
		fields: [recordingCameras.recordedBy],
		references: [users.id]
	}),
	recordingMarkers: many(recordingMarkers),
}));

export const recordingMarkersRelations = relations(recordingMarkers, ({one}) => ({
	highlight: one(highlights, {
		fields: [recordingMarkers.highlightId],
		references: [highlights.id]
	}),
	matchParticipant: one(matchParticipants, {
		fields: [recordingMarkers.participantId],
		references: [matchParticipants.id]
	}),
	recordingCamera: one(recordingCameras, {
		fields: [recordingMarkers.cameraId],
		references: [recordingCameras.id]
	}),
	recordingSession: one(recordingSessions, {
		fields: [recordingMarkers.sessionId],
		references: [recordingSessions.id]
	}),
	user: one(users, {
		fields: [recordingMarkers.createdBy],
		references: [users.id]
	}),
}));

export const recordingSessionsRelations = relations(recordingSessions, ({one, many}) => ({
	match: one(matches, {
		fields: [recordingSessions.matchId],
		references: [matches.id]
	}),
	user: one(users, {
		fields: [recordingSessions.hostUserId],
		references: [users.id]
	}),
	highlights: many(highlights),
	mediaProcessingJobs: many(mediaProcessingJobs),
	recordingCameras: many(recordingCameras),
	recordingMarkers: many(recordingMarkers),
}));

export const refundsRelations = relations(refunds, ({one, many}) => ({
	booking: one(bookings, {
		fields: [refunds.bookingId],
		references: [bookings.id]
	}),
	currency: one(currencies, {
		fields: [refunds.currency],
		references: [currencies.code]
	}),
	payment: one(payments, {
		fields: [refunds.paymentId],
		references: [payments.id]
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

export const sportsRelations = relations(sports, ({many}) => ({
	competitions: many(competitions),
	hostSports: many(hostSports),
	matches: many(matches),
	pitchSports: many(pitchSports),
	playerRatingChanges: many(playerRatingChanges),
	playerSportProfiles: many(playerSportProfiles),
	teams: many(teams),
	waiverTemplates: many(waiverTemplates),
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

export const teamsRelations = relations(teams, ({one, many}) => ({
	city: one(cities, {
		fields: [teams.cityId],
		references: [cities.id]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [teams.logoMediaId],
		references: [mediaAssets.id]
	}),
	sport: one(sports, {
		fields: [teams.sportId],
		references: [sports.id]
	}),
	user: one(users, {
		fields: [teams.captainUserId],
		references: [users.id]
	}),
	competitionEntries: many(competitionEntries),
	matchSides: many(matchSides),
	teamMembers: many(teamMembers),
}));

export const userRolesRelations = relations(userRoles, ({one}) => ({
	user_grantedBy: one(users, {
		fields: [userRoles.grantedBy],
		references: [users.id],
		relationName: "userRoles_grantedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [userRoles.userId],
		references: [users.id],
		relationName: "userRoles_userId_users_id"
	}),
}));

export const userSessionsRelations = relations(userSessions, ({one}) => ({
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	city: one(cities, {
		fields: [users.homeCityId],
		references: [cities.id]
	}),
	country: one(countries, {
		fields: [users.countryCode],
		references: [countries.code]
	}),
	mediaAsset: one(mediaAssets, {
		fields: [users.avatarMediaId],
		references: [mediaAssets.id],
		relationName: "users_avatarMediaId_mediaAssets_id"
	}),
	auditLogs: many(auditLogs),
	authIdentities: many(authIdentities),
	bookings_cancelledBy: many(bookings, {
		relationName: "bookings_cancelledBy_users_id"
	}),
	bookings_userId: many(bookings, {
		relationName: "bookings_userId_users_id"
	}),
	checkinEvents: many(checkinEvents),
	competitionEntries: many(competitionEntries),
	competitions: many(competitions),
	consents: many(consents),
	dataSubjectRequests_handledBy: many(dataSubjectRequests, {
		relationName: "dataSubjectRequests_handledBy_users_id"
	}),
	dataSubjectRequests_userId: many(dataSubjectRequests, {
		relationName: "dataSubjectRequests_userId_users_id"
	}),
	deviceTokens: many(deviceTokens),
	fieldLeases: many(fieldLeases),
	highlightReactions: many(highlightReactions),
	highlightShares: many(highlightShares),
	highlightTags_taggedBy: many(highlightTags, {
		relationName: "highlightTags_taggedBy_users_id"
	}),
	highlightTags_userId: many(highlightTags, {
		relationName: "highlightTags_userId_users_id"
	}),
	highlights: many(highlights),
	hostProfiles_userId: many(hostProfiles, {
		relationName: "hostProfiles_userId_users_id"
	}),
	hostProfiles_verifiedBy: many(hostProfiles, {
		relationName: "hostProfiles_verifiedBy_users_id"
	}),
	matchEvents: many(matchEvents),
	matchFeedbacks_fromUserId: many(matchFeedback, {
		relationName: "matchFeedback_fromUserId_users_id"
	}),
	matchFeedbacks_toUserId: many(matchFeedback, {
		relationName: "matchFeedback_toUserId_users_id"
	}),
	matchParticipants_checkedInBy: many(matchParticipants, {
		relationName: "matchParticipants_checkedInBy_users_id"
	}),
	matchParticipants_userId: many(matchParticipants, {
		relationName: "matchParticipants_userId_users_id"
	}),
	matchWaitlists: many(matchWaitlist),
	matches: many(matches),
	mediaAssets: many(mediaAssets, {
		relationName: "mediaAssets_ownerUserId_users_id"
	}),
	notifications: many(notifications),
	payments: many(payments),
	playerRatingChanges: many(playerRatingChanges),
	playerSportProfiles: many(playerSportProfiles),
	reconciliationRuns: many(reconciliationRuns),
	recordingCameras: many(recordingCameras),
	recordingMarkers: many(recordingMarkers),
	recordingSessions: many(recordingSessions),
	refunds_initiatedBy: many(refunds, {
		relationName: "refunds_initiatedBy_users_id"
	}),
	refunds_processedBy: many(refunds, {
		relationName: "refunds_processedBy_users_id"
	}),
	teamMembers: many(teamMembers),
	teams: many(teams),
	userRoles_grantedBy: many(userRoles, {
		relationName: "userRoles_grantedBy_users_id"
	}),
	userRoles_userId: many(userRoles, {
		relationName: "userRoles_userId_users_id"
	}),
	userSessions: many(userSessions),
	waiverSignatures: many(waiverSignatures),
	walletAccounts: many(walletAccounts),
}));

export const venueAmenitiesRelations = relations(venueAmenities, ({one}) => ({
	amenity: one(amenities, {
		fields: [venueAmenities.amenityId],
		references: [amenities.id]
	}),
	venue: one(venues, {
		fields: [venueAmenities.venueId],
		references: [venues.id]
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

export const waiverSignaturesRelations = relations(waiverSignatures, ({one, many}) => ({
	match: one(matches, {
		fields: [waiverSignatures.matchId],
		references: [matches.id]
	}),
	user: one(users, {
		fields: [waiverSignatures.userId],
		references: [users.id]
	}),
	waiverTemplate: one(waiverTemplates, {
		fields: [waiverSignatures.templateId],
		references: [waiverTemplates.id]
	}),
	bookings: many(bookings),
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

export const walletAccountsRelations = relations(walletAccounts, ({one, many}) => ({
	currency: one(currencies, {
		fields: [walletAccounts.currency],
		references: [currencies.code]
	}),
	user: one(users, {
		fields: [walletAccounts.userId],
		references: [users.id]
	}),
	walletTransactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one}) => ({
	booking: one(bookings, {
		fields: [walletTransactions.bookingId],
		references: [bookings.id]
	}),
	refund: one(refunds, {
		fields: [walletTransactions.refundId],
		references: [refunds.id]
	}),
	walletAccount: one(walletAccounts, {
		fields: [walletTransactions.walletId],
		references: [walletAccounts.id]
	}),
}));
