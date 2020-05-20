import React from 'react';
import PropTypes from 'prop-types';
import { Alert, Clipboard, Share } from 'react-native';
import { connect } from 'react-redux';
import moment from 'moment';
import * as Haptics from 'expo-haptics';

import RocketChat from '../../lib/rocketchat';
import database from '../../lib/database';
import I18n from '../../i18n';
import log from '../../utils/log';
import Navigation from '../../lib/Navigation';
import { getMessageTranslation } from '../message/utils';
import { LISTENER } from '../Toast';
import EventEmitter from '../../utils/events';
import { showConfirmationAlert } from '../../utils/info';
import { connectActionSheet } from '../../actionSheet';
import Header from './Header';

class MessageActions extends React.Component {
	static propTypes = {
		server: PropTypes.string,
		room: PropTypes.object.isRequired,
		message: PropTypes.object,
		user: PropTypes.object,
		editInit: PropTypes.func.isRequired,
		reactionInit: PropTypes.func.isRequired,
		replyInit: PropTypes.func.isRequired,
		isReadOnly: PropTypes.bool,
		Message_AllowDeleting: PropTypes.bool,
		Message_AllowDeleting_BlockDeleteInMinutes: PropTypes.number,
		Message_AllowEditing: PropTypes.bool,
		Message_AllowEditing_BlockEditInMinutes: PropTypes.number,
		Message_AllowPinning: PropTypes.bool,
		Message_AllowStarring: PropTypes.bool,
		Message_Read_Receipt_Store_Users: PropTypes.bool,
		showActionSheetWithOptions: PropTypes.func,
		actionsHide: PropTypes.func
	};

	constructor(props) {
		super(props);
		this.handleActionPress = this.handleActionPress.bind(this);
	}

	async componentDidMount() {
		await this.setPermissions();

		const {
			Message_AllowStarring, Message_AllowPinning, Message_Read_Receipt_Store_Users, user, room, message, isReadOnly
		} = this.props;

		// Reply
		if (!isReadOnly) {
			this.options = [{ title: I18n.t('Reply'), icon: 'reply' }];
			this.REPLY_INDEX = 0;
		}

		// Edit
		if (this.allowEdit(this.props)) {
			this.options.push({ title: I18n.t('Edit'), icon: 'edit' });
			this.EDIT_INDEX = this.options.length - 1;
		}

		// Create Discussion
		this.options.push({ title: I18n.t('Create_Discussion'), icon: 'discussion' });
		this.CREATE_DISCUSSION_INDEX = this.options.length - 1;

		// Mark as unread
		if (message.u && message.u._id !== user.id) {
			this.options.push({ title: I18n.t('Mark_unread'), icon: 'flag' });
			this.UNREAD_INDEX = this.options.length - 1;
		}

		// Permalink
		this.options.push({ title: I18n.t('Permalink'), icon: 'permalink' });
		this.PERMALINK_INDEX = this.options.length - 1;

		// Copy
		this.options.push({ title: I18n.t('Copy'), icon: 'copy' });
		this.COPY_INDEX = this.options.length - 1;

		// Share
		this.options.push({ title: I18n.t('Share'), icon: 'share' });
		this.SHARE_INDEX = this.options.length - 1;

		// Quote
		if (!isReadOnly) {
			this.options.push({ title: I18n.t('Quote'), icon: 'quote' });
			this.QUOTE_INDEX = this.options.length - 1;
		}

		// Star
		if (Message_AllowStarring) {
			this.options.push({ title: I18n.t(message.starred ? 'Unstar' : 'Star'), icon: 'star' });
			this.STAR_INDEX = this.options.length - 1;
		}

		// Pin
		if (Message_AllowPinning) {
			this.options.push({ title: I18n.t(message.pinned ? 'Unpin' : 'Pin'), icon: 'pin' });
			this.PIN_INDEX = this.options.length - 1;
		}

		// Reaction
		if (!isReadOnly || this.canReactWhenReadOnly()) {
			this.options.push({ title: I18n.t('Add_Reaction'), icon: 'add-reaction' });
			this.REACTION_INDEX = this.options.length - 1;
		}

		// Read Receipts
		if (Message_Read_Receipt_Store_Users) {
			this.options.push({ title: I18n.t('Read_Receipt'), icon: 'receipt' });
			this.READ_RECEIPT_INDEX = this.options.length - 1;
		}

		// Toggle Auto-translate
		if (room.autoTranslate && message.u && message.u._id !== user.id) {
			this.options.push({ title: I18n.t(message.autoTranslate ? 'View_Original' : 'Translate'), icon: 'translate' });
			this.TOGGLE_TRANSLATION_INDEX = this.options.length - 1;
		}

		// Report
		this.options.push({ title: I18n.t('Report'), icon: 'report', danger: true });
		this.REPORT_INDEX = this.options.length - 1;

		// Delete
		if (this.allowDelete(this.props)) {
			this.options.push({ title: I18n.t('Delete'), icon: 'trash', danger: true });
			this.DELETE_INDEX = this.options.length - 1;
		}

		try {
			const db = database.active;
			const freqEmojiCollection = db.collections.get('frequently_used_emojis');
			this.freqEmojis = await freqEmojiCollection.query().fetch();
			this.freqEmojis = this.freqEmojis.concat(['clap', '+1', 'heart_eyes', 'grinning', 'thinking_face', 'smiley']);
			this.freqEmojis = this.freqEmojis.slice(0, 6);
		} catch {
			// Do nothing
		}

		setTimeout(() => {
			this.showActionSheet();
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		});
	}

	async setPermissions() {
		try {
			const { room } = this.props;
			const permissions = ['edit-message', 'delete-message', 'force-delete-message'];
			const result = await RocketChat.hasPermission(permissions, room.rid);
			this.hasEditPermission = result[permissions[0]];
			this.hasDeletePermission = result[permissions[1]];
			this.hasForceDeletePermission = result[permissions[2]];
		} catch (e) {
			log(e);
		}
		Promise.resolve();
	}

	showActionSheet = () => {
		const { showActionSheetWithOptions, server } = this.props;
		showActionSheetWithOptions({
			options: this.options,
			header: () => (
				<Header
					server={server}
					items={this.freqEmojis}
					onAdd={this.handleReaction}
				/>
			)
		}, (actionIndex) => {
			this.handleActionPress(actionIndex);
		});
	}

	getPermalink = async(message) => {
		try {
			return await RocketChat.getPermalinkMessage(message);
		} catch (error) {
			return null;
		}
	}

	isOwn = props => props.message.u && props.message.u._id === props.user.id;

	canReactWhenReadOnly = () => {
		const { room } = this.props;
		return room.reactWhenReadOnly;
	}

	allowEdit = (props) => {
		if (props.isReadOnly) {
			return false;
		}
		const editOwn = this.isOwn(props);
		const { Message_AllowEditing: isEditAllowed, Message_AllowEditing_BlockEditInMinutes } = this.props;

		if (!(this.hasEditPermission || (isEditAllowed && editOwn))) {
			return false;
		}
		const blockEditInMinutes = Message_AllowEditing_BlockEditInMinutes;
		if (blockEditInMinutes) {
			let msgTs;
			if (props.message.ts != null) {
				msgTs = moment(props.message.ts);
			}
			let currentTsDiff;
			if (msgTs != null) {
				currentTsDiff = moment().diff(msgTs, 'minutes');
			}
			return currentTsDiff < blockEditInMinutes;
		}
		return true;
	}

	allowDelete = (props) => {
		if (props.isReadOnly) {
			return false;
		}

		// Prevent from deleting thread start message when positioned inside the thread
		if (props.tmid && props.tmid === props.message.id) {
			return false;
		}
		const deleteOwn = this.isOwn(props);
		const { Message_AllowDeleting: isDeleteAllowed, Message_AllowDeleting_BlockDeleteInMinutes } = this.props;
		if (!(this.hasDeletePermission || (isDeleteAllowed && deleteOwn) || this.hasForceDeletePermission)) {
			return false;
		}
		if (this.hasForceDeletePermission) {
			return true;
		}
		const blockDeleteInMinutes = Message_AllowDeleting_BlockDeleteInMinutes;
		if (blockDeleteInMinutes != null && blockDeleteInMinutes !== 0) {
			let msgTs;
			if (props.message.ts != null) {
				msgTs = moment(props.message.ts);
			}
			let currentTsDiff;
			if (msgTs != null) {
				currentTsDiff = moment().diff(msgTs, 'minutes');
			}
			return currentTsDiff < blockDeleteInMinutes;
		}
		return true;
	}

	handleDelete = () => {
		showConfirmationAlert({
			message: I18n.t('You_will_not_be_able_to_recover_this_message'),
			callToAction: I18n.t('Delete'),
			onPress: async() => {
				const { message } = this.props;
				try {
					await RocketChat.deleteMessage(message.id, message.subscription.id);
				} catch (e) {
					log(e);
				}
			}
		});
	}

	handleEdit = () => {
		const { message, editInit } = this.props;
		editInit(message);
	}

	handleUnread = async() => {
		const { message, room } = this.props;
		const { id: messageId, ts } = message;
		const { rid } = room;
		try {
			const db = database.active;
			const result = await RocketChat.markAsUnread({ messageId });
			if (result.success) {
				const subCollection = db.collections.get('subscriptions');
				const subRecord = await subCollection.find(rid);
				await db.action(async() => {
					try {
						await subRecord.update(sub => sub.lastOpen = ts);
					} catch {
						// do nothing
					}
				});
				Navigation.navigate('RoomsListView');
			}
		} catch (e) {
			log(e);
		}
	}

	handleCopy = async() => {
		const { message } = this.props;
		await Clipboard.setString(message.msg);
		EventEmitter.emit(LISTENER, { message: I18n.t('Copied_to_clipboard') });
	}

	handleShare = async() => {
		const { message } = this.props;
		const permalink = await this.getPermalink(message);
		if (!permalink) {
			return;
		}
		Share.share({
			message: permalink
		});
	};

	handleStar = async() => {
		const { message } = this.props;
		try {
			await RocketChat.toggleStarMessage(message.id, message.starred);
			EventEmitter.emit(LISTENER, { message: message.starred ? I18n.t('Message_unstarred') : I18n.t('Message_starred') });
		} catch (e) {
			log(e);
		}
	}

	handlePermalink = async() => {
		const { message } = this.props;
		const permalink = await this.getPermalink(message);
		Clipboard.setString(permalink);
		EventEmitter.emit(LISTENER, { message: I18n.t('Permalink_copied_to_clipboard') });
	}

	handlePin = async() => {
		const { message } = this.props;
		try {
			await RocketChat.togglePinMessage(message.id, message.pinned);
		} catch (e) {
			log(e);
		}
	}

	handleReply = () => {
		const { message, replyInit } = this.props;
		replyInit(message, true);
	}

	handleQuote = () => {
		const { message, replyInit } = this.props;
		replyInit(message, false);
	}

	handleReaction = () => {
		const { message, reactionInit } = this.props;
		reactionInit(message);
	}

	handleReadReceipt = () => {
		const { message } = this.props;
		Navigation.navigate('ReadReceiptsView', { messageId: message.id });
	}

	handleReport = async() => {
		const { message } = this.props;
		try {
			await RocketChat.reportMessage(message.id);
			Alert.alert(I18n.t('Message_Reported'));
		} catch (e) {
			log(e);
		}
	}

	handleToggleTranslation = async() => {
		const { message, room } = this.props;
		try {
			const db = database.active;
			await db.action(async() => {
				await message.update((m) => {
					m.autoTranslate = !m.autoTranslate;
					m._updatedAt = new Date();
				});
			});
			const translatedMessage = getMessageTranslation(message, room.autoTranslateLanguage);
			if (!translatedMessage) {
				const m = {
					_id: message.id,
					rid: message.subscription.id,
					u: message.u,
					msg: message.msg
				};
				await RocketChat.translateMessage(m, room.autoTranslateLanguage);
			}
		} catch (e) {
			log(e);
		}
	}

	handleCreateDiscussion = () => {
		const { message, room: channel } = this.props;
		Navigation.navigate('CreateDiscussionView', { message, channel });
	}

	handleActionPress = (actionIndex) => {
		if (actionIndex >= 0) {
			switch (actionIndex) {
				case this.REPLY_INDEX:
					this.handleReply();
					break;
				case this.EDIT_INDEX:
					this.handleEdit();
					break;
				case this.UNREAD_INDEX:
					this.handleUnread();
					break;
				case this.PERMALINK_INDEX:
					this.handlePermalink();
					break;
				case this.COPY_INDEX:
					this.handleCopy();
					break;
				case this.SHARE_INDEX:
					this.handleShare();
					break;
				case this.QUOTE_INDEX:
					this.handleQuote();
					break;
				case this.STAR_INDEX:
					this.handleStar();
					break;
				case this.PIN_INDEX:
					this.handlePin();
					break;
				case this.REACTION_INDEX:
					this.handleReaction();
					break;
				case this.REPORT_INDEX:
					this.handleReport();
					break;
				case this.DELETE_INDEX:
					this.handleDelete();
					break;
				case this.READ_RECEIPT_INDEX:
					this.handleReadReceipt();
					break;
				case this.CREATE_DISCUSSION_INDEX:
					this.handleCreateDiscussion();
					break;
				case this.TOGGLE_TRANSLATION_INDEX:
					this.handleToggleTranslation();
					break;
				default:
					break;
			}
		}
		const { actionsHide } = this.props;
		actionsHide();
	}

	render() {
		return (
			null
		);
	}
}

const mapStateToProps = state => ({
	server: state.server.server,
	Message_AllowDeleting: state.settings.Message_AllowDeleting,
	Message_AllowDeleting_BlockDeleteInMinutes: state.settings.Message_AllowDeleting_BlockDeleteInMinutes,
	Message_AllowEditing: state.settings.Message_AllowEditing,
	Message_AllowEditing_BlockEditInMinutes: state.settings.Message_AllowEditing_BlockEditInMinutes,
	Message_AllowPinning: state.settings.Message_AllowPinning,
	Message_AllowStarring: state.settings.Message_AllowStarring,
	Message_Read_Receipt_Store_Users: state.settings.Message_Read_Receipt_Store_Users
});

export default connect(mapStateToProps)(connectActionSheet(MessageActions));