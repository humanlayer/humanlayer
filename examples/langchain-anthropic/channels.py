from humanlayer import ContactChannel, SlackContactChannel

dm_with_ceo = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",
        context_about_channel_or_user="a DM with the ceo",
        experimental_slack_blocks=True,
    )
)
