from humanlayer import ContactChannel, SlackContactChannel

dm_with_ceo = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07G4JBB0MC",
        context_about_channel_or_user="a DM with the ceo",
    )
)
dm_with_head_of_marketing = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07GB7BH3S6",
        context_about_channel_or_user="a DM with the head of marketing",
    ),
)
dm_with_summer_intern = ContactChannel(
    slack=SlackContactChannel(
        channel_or_user_id="C07BU3B7DBM",
        context_about_channel_or_user="a DM with the summer intern",
    ),
)
