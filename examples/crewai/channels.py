from humanlayer import ContactChannel, SlackContactChannel

dm_with_ceo = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5JL15F",
        context_about_channel_or_user="a DM with the ceo",
    )
)
dm_with_head_of_marketing = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07H5RZMBK8",
        context_about_channel_or_user="a DM with the head of marketing",
    ),
)
dm_with_summer_intern = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07H5S4E6EA",
        context_about_channel_or_user="a DM with the summer intern",
    ),
)
channel_with_sre_team = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07HR5LJ0KT",
        context_about_channel_or_user="a channel with the SRE team",
    ),
)
